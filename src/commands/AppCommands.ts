/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openInPortal } from "@microsoft/vscode-azext-azureutils";
import { AzExtTreeItem, DialogResponses, IActionContext, openReadOnlyJson, openUrl } from "@microsoft/vscode-azext-utils";
import { MessageItem, OpenDialogOptions, TextEditor, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { ext } from "../extensionVariables";
import { EnhancedApp } from "../service/EnhancedApp";
import { DebugController } from "../service/remotedebugging/DebugController";
import { AppInstanceTreeItem } from "../tree/AppInstanceTreeItem";
import { AppSettingsTreeItem } from "../tree/AppSettingsTreeItem";
import { AppSettingTreeItem } from "../tree/AppSettingTreeItem";
import { AppTreeItem } from "../tree/AppTreeItem";
import * as utils from "../utils";

export namespace AppCommands {

    export async function openPublicEndpoint(context: IActionContext, n?: AzExtTreeItem): Promise<void> {
        const node: AppTreeItem = await getNode(n, context);
        const app: EnhancedApp = node.app;
        let endPoint: string | undefined = await app.getPublicEndpoint();
        if (!endPoint || endPoint.toLowerCase() === 'none') {
            await context.ui.showWarningMessage(`App [${app.name}] is not publicly accessible. Do you want to set it public and assign it a public endpoint?`, { modal: true }, DialogResponses.yes);
            await toggleEndpoint(context, node);
            endPoint = await app.getPublicEndpoint();
        }
        await openUrl(endPoint!);
    }

    export async function openTestEndpoint(context: IActionContext, n?: AzExtTreeItem): Promise<void> {
        const node: AppTreeItem = await getNode(n, context);
        const app: EnhancedApp = node.app;
        const endpoint: string | undefined = await app.getTestEndpoint();
        await openUrl(endpoint!);
    }

    export async function toggleEndpoint(context: IActionContext, n?: AzExtTreeItem): Promise<void> {
        const node: AppTreeItem = await getNode(n, context);
        const app: EnhancedApp = node.app;
        const isPublic: boolean = app.properties?.public ?? false;
        const doing: string = isPublic ? `Unassigning public endpoint of "${app.name}".` : `Assigning public endpoint to "${app.name}".`;
        const done: string = isPublic ? `Successfully unassigned public endpoint of "${app.name}".` : `Successfully assigned public endpoint to "${app.name}".`;
        await utils.runInBackground(doing, done, () => app.setPublic(!isPublic));
    }

    export async function startApp(context: IActionContext, n?: AzExtTreeItem): Promise<AppTreeItem> {
        const node: AppTreeItem = await getNode(n, context);
        const app: EnhancedApp = node.app;
        await node.runWithTemporaryDescription(context, utils.localize('starting', 'Starting...'), async () => {
            await app.start();
            await node!.refresh(context);
        });
        return node;
    }

    export async function stopApp(context: IActionContext, n?: AzExtTreeItem): Promise<AppTreeItem> {
        const node: AppTreeItem = await getNode(n, context);
        const app: EnhancedApp = node.app;
        const stopResponse: MessageItem = { title: 'Stop' };
        await context.ui.showWarningMessage(`Are you sure to stop "${app.name}"?`, { modal: true }, stopResponse);
        await node.runWithTemporaryDescription(context, utils.localize('stopping', 'Stopping...'), async () => {
            await app.stop();
            await node!.refresh(context);
        });
        return node;
    }

    export async function restartApp(context: IActionContext, n?: AzExtTreeItem): Promise<AppTreeItem> {
        const node: AppTreeItem = await getNode(n, context);
        const app: EnhancedApp = node.app;
        await node.runWithTemporaryDescription(context, utils.localize('restart', 'Restarting...'), async () => {
            await app.restart();
            await node!.refresh(context);
        });
        return node;
    }

    export async function deleteApp(context: IActionContext, n?: AzExtTreeItem): Promise<void> {
        const node: AppTreeItem = await getNode(n, context);
        const app: EnhancedApp = node.app;
        await context.ui.showWarningMessage(`Are you sure to delete "${app.name}"?`, { modal: true }, DialogResponses.deleteResponse);
        const deleting: string = utils.localize('deletingSpringCLoudApp', 'Deleting Spring app "{0}"...', app.name);
        const deleted: string = utils.localize('deletedSpringCLoudApp', 'Successfully deleted Spring app "{0}".', app.name);
        await utils.runInBackground(deleting, deleted, () => node!.deleteTreeItem(context));
    }

    export async function deploy(context: IActionContext, n?: AzExtTreeItem): Promise<AppTreeItem> {
        const node: AppTreeItem = await getNode(n, context);
        const defaultUri: Uri | undefined = await getTargetOrWorkspacePath();
        const options: OpenDialogOptions = {
            defaultUri,
            canSelectMany: false,
            openLabel: 'Select',
            filters: {
                'Jar files': ['jar']
            }
        };
        const fileUri: Uri[] | undefined = await window.showOpenDialog(options);
        if (fileUri && fileUri[0] !== undefined) {
            const artifactPath: string = fileUri[0].fsPath;
            await node.runWithTemporaryDescription(context, utils.localize('deploying', 'Deploying...'), async () => node!.deployArtifact(context, artifactPath));
        }
        return node;
    }

    export async function scale(context: IActionContext, n?: AzExtTreeItem): Promise<AppTreeItem> {
        const node: AppTreeItem = await getNode(n, context);
        await node.scaleInstances(context);
        return node;
    }

    export async function openPortal(context: IActionContext, n?: AzExtTreeItem): Promise<AppTreeItem> {
        const node: AppTreeItem = await getNode(n, context);
        await openInPortal(node, node.fullId);
        return node;
    }

    export async function viewProperties(context: IActionContext, n?: AzExtTreeItem): Promise<AppTreeItem> {
        const node: AppTreeItem = await getNode(n, context);
        await openReadOnlyJson(node, node.app.properties ?? {});
        return node;
    }

    export async function startStreamingLogs(context: IActionContext, n?: AzExtTreeItem): Promise<AppInstanceTreeItem> {
        const node: AppInstanceTreeItem = await getInstanceNode(n, context);
        await node.runWithTemporaryDescription(context, utils.localize('startStreamingLog', 'Starting streaming log...'), async () => {
            const appTreeItem: AppTreeItem = node!.parent.parent;
            const app: EnhancedApp = appTreeItem.app;
            return app.startStreamingLogs(context, node?.instance!);
        });
        return node;
    }

    export async function startRemoteDebugging(context: IActionContext, n?: AzExtTreeItem): Promise<AppInstanceTreeItem> {
        const node: AppInstanceTreeItem = await getInstanceNode(n, context);
        await node.runWithTemporaryDescription(context, utils.localize('startRemoteDebugging', 'Attaching debugger...'), async () => {
            // return new DebugProxy(node?.instance!, 5005).start();
            return DebugController.attachDebugger(context, node?.instance!);
        });
        return node;
    }

    export async function stopStreamingLogs(context: IActionContext, n?: AzExtTreeItem): Promise<AppInstanceTreeItem> {
        const node: AppInstanceTreeItem = await getInstanceNode(n, context);
        await node.runWithTemporaryDescription(context, utils.localize('stopStreamingLog', 'Stopping streaming log...'), async () => {
            const appTreeItem: AppTreeItem = node!.parent.parent;
            const app: EnhancedApp = appTreeItem.app;
            return app.stopStreamingLogs(node?.instance!);
        });
        return node;
    }

    export async function viewInstanceProperties(context: IActionContext, n?: AzExtTreeItem): Promise<AppInstanceTreeItem> {
        const node: AppInstanceTreeItem = await getInstanceNode(n, context);
        const { deployment, ...instance } = node.instance;
        await openReadOnlyJson(node, instance);
        return node;
    }

    export async function toggleVisibility(context: IActionContext, node: AppSettingTreeItem | AppSettingsTreeItem): Promise<void> {
        await node.toggleVisibility(context);
    }

    export async function addSetting(context: IActionContext, node: AppSettingsTreeItem): Promise<void> {
        await node.createChild(context);
    }

    export async function editSettings(context: IActionContext, node: AppSettingsTreeItem): Promise<void> {
        await node.runWithTemporaryDescription(context, utils.localize('editing', 'Editing...'), async () => {
            await node.updateSettingsValue(context);
        });
    }

    export async function editSetting(context: IActionContext, node: AppSettingTreeItem): Promise<AppSettingTreeItem> {
        await node.runWithTemporaryDescription(context, utils.localize('editing', 'Editing...'), async () => {
            await node.updateValue(context);
        });
        return node;
    }

    export async function deleteSetting(context: IActionContext, node: AppSettingTreeItem): Promise<AppSettingTreeItem> {
        await context.ui.showWarningMessage(`Are you sure to delete "${node.key || node.value}"?`, { modal: true }, DialogResponses.deleteResponse);
        await node.deleteTreeItem(context);
        return node;
    }

    async function getNode(node: AzExtTreeItem | undefined, context: IActionContext): Promise<AppTreeItem> {
        if (node && node instanceof AppTreeItem) {
            return node;
        }
        return await ext.tree.showTreeItemPicker<AppTreeItem>(AppTreeItem.contextValue, context, node);
    }

    async function getInstanceNode(node: AzExtTreeItem | undefined, context: IActionContext): Promise<AppInstanceTreeItem> {
        if (node && node instanceof AppInstanceTreeItem) {
            return node;
        }
        return await ext.tree.showTreeItemPicker<AppInstanceTreeItem>(AppInstanceTreeItem.contextValue, context, node);
    }

    async function getTargetOrWorkspacePath(): Promise<Uri | undefined> {
        const editor: TextEditor | undefined = window.activeTextEditor;
        let root: WorkspaceFolder | undefined = workspace.workspaceFolders?.[0];
        if (editor && editor.document.uri.scheme === 'file') {
            root = workspace.getWorkspaceFolder(editor.document.uri) ?? root;
        }
        return root ? Uri.joinPath(root.uri, 'target') : undefined;
    }

}
