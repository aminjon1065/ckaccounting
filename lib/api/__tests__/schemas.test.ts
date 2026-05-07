import { paginatedSchema, saleSchema } from "../schemas";

describe("saleSchema", () => {
  test("accepts a complete server payload", () => {
    const payload = {
      id: "sale-uuid",
      type: "product",
      user_id: 7,
      customer_name: "Alice",
      total: 100,
      discount: 5,
      paid: 50,
      debt: 50,
      payment_type: "cash",
      notes: null,
      items: [
        {
          id: "item-uuid",
          product_id: "prod-uuid",
          product_name: "Сыр",
          quantity: 2,
          price: 50,
          total: 100,
        },
      ],
      created_at: "2026-05-07T10:00:00Z",
      updated_at: "2026-05-07T10:00:00Z",
      version: 3,
    };
    const result = saleSchema.parse(payload);
    expect(result.id).toBe("sale-uuid");
    expect(result.items).toHaveLength(1);
  });

  test("rejects wrong types on known fields", () => {
    const bad = { id: 123, /* should be string */ items: [] };
    const result = saleSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  test("preserves unknown extra fields (passthrough — server can extend)", () => {
    const payload = {
      id: "sale-uuid",
      customer_name: null,
      total: 100,
      discount: 0,
      paid: 100,
      debt: 0,
      payment_type: "card",
      items: [],
      created_at: "2026-05-07T10:00:00Z",
      updated_at: "2026-05-07T10:00:00Z",
      // Future server adds something
      futureField: "ok",
    };
    const result = saleSchema.parse(payload) as { futureField?: string };
    expect(result.futureField).toBe("ok");
  });
});

describe("paginatedSchema", () => {
  test("accepts both length-aware and cursor pagination shapes", () => {
    const schema = paginatedSchema(saleSchema);

    const lengthAware = schema.safeParse({
      data: [],
      meta: { current_page: 1, last_page: 5, per_page: 20, total: 100 },
      links: { first: "x", last: "y", prev: null, next: "z" },
    });
    expect(lengthAware.success).toBe(true);

    const cursorBased = schema.safeParse({
      data: [],
      next_cursor: "abc",
    });
    expect(cursorBased.success).toBe(true);
  });

  test("rejects non-array data", () => {
    const schema = paginatedSchema(saleSchema);
    expect(schema.safeParse({ data: "not-array" }).success).toBe(false);
  });
});
