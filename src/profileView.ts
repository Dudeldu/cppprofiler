import * as vscode from 'vscode';
import { PerfEventData, FunctionCall } from './profileParser';
import { decorate } from './profileDecorator';

export class PerfProfileViewProvider implements vscode.TreeDataProvider<FunctionCall> {
  private _onDidChangeTreeData: vscode.EventEmitter<FunctionCall | undefined | void> = new vscode.EventEmitter<FunctionCall | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FunctionCall | undefined | void> = this._onDidChangeTreeData.event;

  private data: PerfEventData | undefined;
  private decoration: vscode.TextEditorDecorationType[] | undefined;

  refresh(data?: PerfEventData): void {
    this.data = data;
    if (!this.data) {
      vscode.window.showErrorMessage('Run profiling Task first');
    }
    this._onDidChangeTreeData.fire();
  }

  async applyDecoration(): Promise<void> {
    if (this.decoration) {
      this.removeDecoration();
      return;
    }
    let openEditors = vscode.window.visibleTextEditors;
    if (!this.data) {
      return;
    }
    this.decoration = [];
    for (let editor of openEditors) {
      let decoration = await decorate(editor, this.data);
      if (decoration) {
        this.decoration.push(decoration);
      }
    }

  }

  removeDecoration(): void {
    if (this.decoration) {
      this.decoration.forEach((x) => x.dispose());
      this.decoration = undefined;
    }
  }

  constructor(data?: PerfEventData) {
    this.data = data;
  }

  getTreeItem(element: FunctionCall): vscode.TreeItem {
    return new FunctionCallView(element, vscode.TreeItemCollapsibleState.Collapsed);
  }

  getChildren(element?: FunctionCall): FunctionCall[] {
    if (element) {
      return element.getFunctionCalls();
    } else {
      if (!this.data) {
        return [];
      }
      return this.data.getFunctionCalls();
    }
  }
}

class FunctionCallView extends vscode.TreeItem {
  constructor(
    private functionCall: FunctionCall,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super({
      "label": functionCall.getSampleProportion() + " " + functionCall.info.symbol,
      "highlights": [[0, functionCall.getSampleProportion().length]]
    }, collapsibleState);
    this.tooltip = `${this.functionCall.info.symbol}    ${this.functionCall.info.src.path}:${this.functionCall.info.line}`;
    this.description = `${this.functionCall.info.filename}:${this.functionCall.info.line}`;
  }
}