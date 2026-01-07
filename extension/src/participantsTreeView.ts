import { EventEmitter, ProviderResult, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Event, ThemeIcon } from 'vscode';
import { ActiveSessionsMessage } from './ipc';

const NO_DATA_ID = "no-data";

export class ParticipantsTreeViewDataProvider implements TreeDataProvider<Participant> {
  private _onDidChangeTreeData: EventEmitter<null> = new EventEmitter<null>();
  readonly onDidChangeTreeData: Event<null> = this._onDidChangeTreeData.event;
  private data: ActiveSessionsMessage | null = null;

  setActiveSessions(data: ActiveSessionsMessage | null) {
    this.data = data;
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(element: Participant): Participant | Thenable<Participant> {
    return element;
  }

  getChildren(element?: Participant | undefined): ProviderResult<Participant[]> {
    if (element === undefined) {
      if (this.data === null) {
        return [new Participant(NO_DATA_ID, "Open a file to see other participants here. This may take a few seconds to load.", "", -1)];
      }

      const participants = this.data.sessions.map(session => {
        const me = session.id === this.data!.sessionId;
        return new Participant(
          session.id,
          me ? `You (${session.name})` : session.name,
          session.path,
          me ? -1 : session.distance
        );
      });

      participants.sort((a, b) => a.distance - b.distance);
      return participants;
    }

    return [];
  }
};


class Participant extends TreeItem {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly path: string,
    public readonly distance: number
  ) {
    super(name, TreeItemCollapsibleState.None);
    this.id = id;
    this.description = path;
    this.distance = distance;

    if (id === NO_DATA_ID) return;

    let hopText = `${distance} hop${distance === 1 ? "" : "s"}`;
    if (distance <= 0) {
      hopText = "In the same file";
      this.iconPath = new ThemeIcon("file");
    } else if (distance <= 2) {
      this.iconPath = new ThemeIcon("unmute");
    }
    this.tooltip = `${name} | ${path} | ${hopText}`;
  }
}