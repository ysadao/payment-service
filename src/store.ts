import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export class Store<T extends object> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly seed: T,
  ) {}

  private enqueue<R>(fn: () => Promise<R>): Promise<R> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  read(): Promise<T> {
    return this.enqueue(async () => this.readUnsafe());
  }

  update(mutator: (data: T) => void | Promise<void>): Promise<T> {
    return this.enqueue(async () => {
      const data = await this.readUnsafe();
      await mutator(data);
      await this.writeUnsafe(data);
      return data;
    });
  }

  private async readUnsafe(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...structuredClone(this.seed), ...(JSON.parse(raw) as T) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        await this.writeUnsafe(structuredClone(this.seed));
        return structuredClone(this.seed);
      }
      throw err;
    }
  }

  private async writeUnsafe(data: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }
}
