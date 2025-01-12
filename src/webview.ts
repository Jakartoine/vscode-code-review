import { window, ViewColumn, ExtensionContext, workspace, Range, WebviewPanel, Uri, TextEditor } from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { ReviewCommentService } from './review-comment';
import { createCommentFromObject, CsvEntry, CsvStructure } from './model';
import { CommentListEntry } from './comment-list-entry';
import { clearSelection, getSelectionRanges } from './utils/editor-utils';
import { colorizedBackgroundDecoration } from './utils/decoration-utils';

export class WebViewComponent {
  /** Store all configured categories */
  private categories: string[] = [];
  /** Store all configured users */
  private users: string[] = [];
  /** Store the initial creator of a code review */
  private initialUser: string = 'unknown';
  /** Store the color for background-highlighting */
  private highlightDecorationColor: string = '';
  /** Panel used to add/edit a comment */
  private panel: WebviewPanel | null = null;
  /** Reference to the working editor during note edition */
  private editor: TextEditor | null = null;

  /**
   * Show the comment edition panel
   *
   * @param title The title of the panel
   * @param fileName The file referenced by the comment
   * @return WebviewPanel The panel object
   */
  private showPanel(title: string, fileName: string): WebviewPanel {
    this.panel?.dispose(); // Dispose existing panel to avoid duplicates
    this.panel = this.createWebView(title);
    this.panel.webview.html = this.getWebviewContent(fileName);

    return this.panel;
  }

  constructor(public context: ExtensionContext) {
    this.categories = workspace.getConfiguration().get('code-review.categories') as string[];
    this.users = workspace.getConfiguration().get('code-review.users') as string[];
    this.initialUser = (workspace.getConfiguration().get('code-review.initialUser') as string) ?? 'unknown';
    this.highlightDecorationColor = workspace
      .getConfiguration()
      .get('code-review.codeSelectionBackgroundColor') as string;
  }

  /**
   * Get and store the working text editor
   *
   * @return TextEditor
   */
  private getWorkingEditor(): TextEditor {
    if (this.editor === null) {
      this.editor = window.activeTextEditor ?? window.visibleTextEditors[0];
    }

    return this.editor;
  }

  /**
   * Dispose the stored working editor
   */
  private disposeWorkingEditor() {
    this.editor = null;
  }

  deleteComment(commentService: ReviewCommentService, entry: CommentListEntry) {
    commentService.deleteComment(entry.id, entry.description);
    this.panel?.dispose();
  }

  editComment(commentService: ReviewCommentService, selections: Range[], data: CsvEntry) {
    const editor = this.getWorkingEditor();
    // Clear the current text selection to avoid unwanted code selection changes.
    // (see `ReviewCommentService::getSelectedLines()`).
    clearSelection(editor);
    // highlight selection
    const decoration = colorizedBackgroundDecoration(selections, editor, this.highlightDecorationColor);

    // initialize new web tab
    const panel = this.showPanel('Edit code review comment', editor.document.fileName);
    // const pathToHtml = Uri.file(path.join(this.context.extensionPath, 'src', 'webview.html'));
    // const pathUri = pathToHtml.with({ scheme: 'vscode-resource' });
    // panel.webview.html = fs.readFileSync(pathUri.fsPath, 'utf8');
    // const priorities = workspace.getConfiguration().get('code-review.priorities') as string[];
    data = CsvStructure.finalizeParse(data);
    panel.webview.postMessage({ comment: { ...data } });

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'submit':
            const formData = JSON.parse(message.text) as CsvEntry;
            const newEntry: CsvEntry = {
              ...data,
              title: formData.title || '',
              additional: formData.additional || '',
              comment: formData.comment || '',
              category: formData.category || '',
              priority: formData.priority || 0,
              done: formData.done || 0,
              responsible: formData.responsible || 'unknown',
              createdBy: formData.createdBy || 'unknown',
              updateDate: new Date().toLocaleDateString(),
              doneBy: formData.doneBy || formData.responsible,
            };
            commentService.updateComment(newEntry, this.getWorkingEditor());
            panel.dispose();
            break;

          case 'cancel':
            panel.dispose();
            break;

          case 'missing-required-fields':
            window.showErrorMessage('Not all fields have been filled in correctly!');
            break;

          case 'delete':
            window
              .showInformationMessage('Do you really want to delete this comment?', ...['Yes', 'No'])
              .then((answer) => {
                if (answer === 'Yes') {
                  commentService.deleteComment(data.id, data.title);
                  panel.dispose();
                } else {
                  // on cancel: load webview again
                  this.editComment(commentService, selections, data);
                }
              });
            break;
        }
      },
      undefined,
      this.context.subscriptions,
    );

    panel.onDidDispose(() => {
      // reset highlight selected lines
      decoration.dispose();
      this.disposeWorkingEditor();
    });
  }

  addComment(commentService: ReviewCommentService) {
    // highlight selected lines
    const editor = this.getWorkingEditor();
    const decoration = colorizedBackgroundDecoration(getSelectionRanges(editor), editor, this.highlightDecorationColor);

    const panel = this.showPanel('Add code review comment', editor.document.fileName);
    panel.webview.postMessage({ comment: { createdBy: this.initialUser, done: 0 }, isNewMessage: true });

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'submit':
            commentService.addComment(createCommentFromObject(message.text), this.getWorkingEditor());
            panel.dispose();
            break;

          case 'missing-required-fields':
            window.showErrorMessage('Not all fields have been filled in correctly!');
            break;

          case 'cancel':
            panel.dispose();
            break;
        }
      },
      undefined,
      this.context.subscriptions,
    );

    panel.onDidDispose(() => {
      // reset highlight selected lines
      decoration.dispose();
      this.disposeWorkingEditor();
    });
  }

  private createWebView(title: string): WebviewPanel {
    return window.createWebviewPanel(
      'text',
      title,
      { viewColumn: ViewColumn.Beside },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
  }

  getWebviewContent(fileName: string): string {
    const uri = Uri.joinPath(this.context.extensionUri, 'dist', 'webview.html');
    const pathUri = uri.with({ scheme: 'vscode-resource' });
    return fs
      .readFileSync(pathUri.fsPath, 'utf8')
      .replace('SELECT_RESPONSIBLE_LIST_STRING', this.prepareSelectListStringWithValues(this.users))
      .replace('SELECT_DONE_BY_LIST_STRING', this.prepareSelectListStringWithValues(this.users))
      .replace('SELECT_CREATOR_LIST_STRING', this.prepareSelectListStringWithValues(this.users))
      .replace('SELECT_LIST_STRING', this.prepareSelectListStringWithValues(this.categories))
      .replace('FILENAME', path.basename(fileName));
  }

  private prepareSelectListStringWithValues(values: string[]): string {
    return values.reduce((current, value) => {
      return current + `<option value="${value}">${value}</option>`;
    }, '');
  }
}
