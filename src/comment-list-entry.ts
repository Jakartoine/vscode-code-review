// @ts-nocheck
import { ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';

import { ReviewFileExportSection } from './interfaces';
import { themeColorForPriority } from './utils/editor-utils';

export class CommentListEntry extends TreeItem {
  public overrideIconPath?: string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon | undefined;
  constructor(
    public readonly id: string,
    public readonly label: string,
    public readonly text: string,
    public readonly hoverLabel: string,
    public readonly collapsibleState: TreeItemCollapsibleState,
    public readonly data: ReviewFileExportSection,
    public readonly prio?: number,
    public readonly done?: number,
  ) {
    super(label, collapsibleState);
  }

  get iconPath(): string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon | undefined {
    if (this.overrideIconPath) {
      return this.overrideIconPath;
    }

    return this.done
      ? new ThemeIcon('pass-filled', themeColorForPriority(this.prio))
      : new ThemeIcon('circle-large-outline', themeColorForPriority(this.prio));
  }

  get tooltip(): string {
    return this.hoverLabel;
  }

  get description(): string {
    return this.text;
  }
}
