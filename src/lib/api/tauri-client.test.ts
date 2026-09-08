import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriError } from "./errors";
import { commands, createCommand, createCommandNoParams } from "./tauri-client";

const invokeMock = vi.mocked(invoke);

describe("createCommand", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("forwards params to invoke under the Rust command name", async () => {
    invokeMock.mockResolvedValue("ok");
    const send = createCommand<{ id: string }, string>("do_thing", { debug: false });

    await expect(send({ id: "abc" })).resolves.toBe("ok");
    expect(invokeMock).toHaveBeenCalledWith("do_thing", { id: "abc" });
  });

  it("passes undefined params for no-arg commands", async () => {
    invokeMock.mockResolvedValue(1);
    await createCommandNoParams<number>("ping", { debug: false })();
    expect(invokeMock).toHaveBeenCalledWith("ping", undefined);
  });

  it("normalises a rejection into a typed TauriError", async () => {
    invokeMock.mockRejectedValue({
      code: "UNAUTHORIZED",
      message: "bad key",
      details: null,
    });

    const send = createCommandNoParams("whoami", { debug: false });
    await expect(send()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "bad key",
    });
  });

  it("rejects with a TauriError once the timeout elapses", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => {}));

    const send = createCommandNoParams("slow", { debug: false, timeout: 50 });
    const promise = send();
    const assertion = expect(promise).rejects.toBeInstanceOf(TauriError);

    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });
});

describe("commands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it("maps camelCase methods to the snake_case names in generate_handler!", async () => {
    await commands.app.getVersion();
    expect(invokeMock).toHaveBeenCalledWith("get_app_version", undefined);

    await commands.app.getRuntimeInfo();
    expect(invokeMock).toHaveBeenCalledWith("get_runtime_info", undefined);

    await commands.credentials.load();
    expect(invokeMock).toHaveBeenCalledWith("load_credentials", undefined);

    await commands.credentials.clear();
    expect(invokeMock).toHaveBeenCalledWith("clear_credentials", undefined);
  });

  it("sends the credential profile as a nested `profile` argument", async () => {
    const profile = {
      profileName: "default",
      apiBaseUrl: "https://api.example.com",
      clientId: "c1",
      apiSecretKey: "sk_test_abcd1234",
    };

    await commands.credentials.save({ profile });
    expect(invokeMock).toHaveBeenCalledWith("save_credentials", { profile });
  });
});
