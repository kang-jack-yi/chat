declare module "socket.io-client" {
  interface Socket {
    io: any;
    connect(): Socket;
    disconnect(): Socket;
    on(event: string, listener: (...args: any[]) => void): Socket;
    off(event: string, listener?: (...args: any[]) => void): Socket;
    emit(event: string, ...args: any[]): Socket;
  }

  interface ConnectOptions {
    path?: string;
    transports?: string[];
    autoConnect?: boolean;
    query?: Record<string, string>;
  }

  export default function io(url?: string, options?: ConnectOptions): Socket;
}

