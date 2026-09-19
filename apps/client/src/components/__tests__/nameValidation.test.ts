import { describe, expect, it } from "vitest";

import { validateNameInput } from "../NameEntry";

describe("name input validation", () => {
  it("accepts valid non-empty string name", () => {
    const formData = new FormData();
    formData.set("name", "Alice");

    expect(validateNameInput(formData)).toEqual({
      success: true,
      name: "Alice",
    });
  });

  it("trims whitespace from name", () => {
    const formData = new FormData();
    formData.set("name", "   Bob   ");

    expect(validateNameInput(formData)).toEqual({
      success: true,
      name: "Bob",
    });
  });

  it("rejects empty or whitespace-only name", () => {
    const emptyForm = new FormData();
    emptyForm.set("name", "");
    expect(validateNameInput(emptyForm)).toEqual({
      success: false,
      error: "Name is required",
    });

    const whitespaceForm = new FormData();
    whitespaceForm.set("name", "    ");
    expect(validateNameInput(whitespaceForm)).toEqual({
      success: false,
      error: "Name is required",
    });
  });

  it("rejects missing name field or non-string values", () => {
    const emptyForm = new FormData();
    expect(validateNameInput(emptyForm)).toEqual({
      success: false,
      error: "Invalid name format",
    });

    const fileForm = new FormData();
    fileForm.set("name", new Blob(["data"], { type: "text/plain" }), "test.txt");
    expect(validateNameInput(fileForm)).toEqual({
      success: false,
      error: "Invalid name format",
    });
  });
});
