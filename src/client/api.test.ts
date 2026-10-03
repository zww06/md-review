import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteComment } from "./api";

describe("deleteComment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not declare an empty DELETE request as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteComment("comment-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/comments/comment-1", expect.objectContaining({
      method: "DELETE",
      body: undefined,
      headers: expect.not.objectContaining({ "Content-Type": expect.anything() }),
    }));
  });
});
