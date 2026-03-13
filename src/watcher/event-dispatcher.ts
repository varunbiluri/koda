import { EventEmitter } from 'events';

export type FileEventType = 'file-changed' | 'file-created' | 'file-deleted';

export interface FileEvent {
  type: FileEventType;
  filePath: string;
  timestamp: number;
}

type Handler<T> = (payload: T) => void | Promise<void>;

/**
 * EventDispatcher - Typed event bus for file system events.
 * Routes file events to interested subscribers.
 */
export class EventDispatcher extends EventEmitter {
  on(event: FileEventType | string, handler: Handler<FileEvent>): this {
    super.on(event, handler);
    return this;
  }

  off(event: FileEventType | string, handler: Handler<FileEvent>): this {
    super.off(event, handler);
    return this;
  }

  emit(event: FileEventType | string, payload?: FileEvent): boolean {
    return super.emit(event, payload);
  }

  dispatch(event: FileEvent): void {
    this.emit(event.type, event);
    this.emit('*', event);
  }
}
