import { describe, expect, test } from "vitest";

import { filterCustomFieldDefinitionsForSourcing } from "../utils/customFieldSourcing.js";

describe("custom field sourcing visibility", () => {
  test("defaults existing definitions to visible and removes explicitly hidden definitions", () => {
    const definitions = [
      { id: 1 },
      { id: 2, showOnSourcingForms: true },
      { id: 3, showOnSourcingForms: false },
    ];

    expect(filterCustomFieldDefinitionsForSourcing(definitions).map((field) => field.id)).toEqual([1, 2]);
  });
});
