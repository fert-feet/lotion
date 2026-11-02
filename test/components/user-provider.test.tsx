// @vitest-environment jsdom
// 会话恢复：StrictMode 双跑 effect 只发一次 /api/me；owner 标记能落到 context。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UserProvider, useUser } from "@/hooks/use-user";

let container: HTMLDivElement;
let root: Root;
let calls: string[] = [];

function Probe() {
  const { user, isOwner, loading } = useUser();
  return (
    <span data-testid="probe">
      {loading ? "loading" : `${user?.email ?? "none"}:${isOwner}`}
    </span>
  );
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(
        JSON.stringify({
          user: { id: "u1", email: "owner@x.com", name: "Owner" },
          isOwner: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("UserProvider", () => {
  it("StrictMode 下只请求一次 /api/me，并带上 isOwner", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <UserProvider initialUser={null}>
            <Probe />
          </UserProvider>
        </StrictMode>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe(
      "owner@x.com:true",
    );
    expect(calls.filter((url) => url.includes("/api/me"))).toHaveLength(1);
  });
});
