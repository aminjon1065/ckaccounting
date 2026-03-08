# React Native API Context (CK Accounting Backend)

## Base URL
- `http://acc-backend.test/api/v1`

## Auth
- Login: `POST /auth/login`
  - body: `{ "email": "...", "password": "...", "device_name": "ios|android" }`
  - returns: `token`, `token_type`, `user`
- Me: `GET /auth/me`
- Logout: `POST /auth/logout`
- Refresh: `POST /auth/refresh`

Use header for protected endpoints:
- `Authorization: Bearer <token>`
- `Accept: application/json`
- `Content-Type: application/json`

## Response Envelope
Success responses use:
```json
{
  "success": true,
  "message": "",
  "data": {}
}
```

Error responses use:
```json
{
  "success": false,
  "message": "Error message",
  "errors": {}
}
```

## Roles
- `super_admin`
- `owner`
- `seller`

User object fields:
- `id`, `shop_id`, `name`, `email`, `role`

## Access Rules (Current Backend)
- `super_admin`: global access, shop-level bypass
- `owner`: own-shop operations
- `seller`: mobile operational role (sales/products/expenses/debts/purchases + reports), no settings change, no user management

## Shop Scope Rules
- All business data is scoped by `shop_id`.
- For non-`super_admin`, cross-shop access returns `404` (anti-ID-tampering).
- For some create operations as `super_admin`, `shop_id` is required in request.

## API Modules and Endpoints

### Products
- `GET /products`
- `POST /products`
- `GET /products/{id}`
- `PUT|PATCH /products/{id}`
- `DELETE /products/{id}`

Create/update fields:
- `name` (required)
- `code` (nullable, unique per shop)
- `unit` (nullable)
- `cost_price` (required)
- `sale_price` (required)
- `stock_quantity` (required)
- `low_stock_alert` (nullable)

### Expenses
- `GET /expenses`
- `POST /expenses`
- `GET /expenses/{id}`
- `PUT|PATCH /expenses/{id}`
- `DELETE /expenses/{id}`

Create fields:
- `name` (required)
- `quantity` (required)
- `price` (required)
- `note` (nullable)
- `shop_id` (optional; used by `super_admin`)

### Debts
- `GET /debts`
- `POST /debts`
- `GET /debts/{id}`
- `POST /debts/{id}/transactions`

Create debt fields:
- `person_name` (required)
- `opening_balance` (nullable)
- `shop_id` (optional; required for `super_admin`)

Transaction fields:
- `type` (required: `give|take|repay`)
- `amount` (required)
- `note` (nullable)

### Purchases
- `GET /purchases`
- `POST /purchases`
- `GET /purchases/{id}`

Create fields:
- `supplier_name` (nullable)
- `shop_id` (optional; required for `super_admin`)
- `items` (required array)
  - `product_id` (required)
  - `quantity` (required)
  - `price` (required)

### Sales
- `GET /sales`
- `POST /sales`
- `GET /sales/{id}`

Create fields:
- `customer_name` (nullable)
- `discount` (nullable)
- `paid` (nullable)
- `payment_type` (`cash|card|transfer`)
- `shop_id` (optional; required for `super_admin`)
- `items` (required array)
  - `product_id` (required)
  - `quantity` (required)
  - `price` (nullable; if omitted, backend uses product sale price)

### Shops
- `GET /shops`
- `POST /shops` (super_admin)
- `GET /shops/{id}`
- `PUT|PATCH /shops/{id}` (super_admin)
- `DELETE /shops/{id}` (super_admin)

### Users
- `GET /users`
- `POST /users`
- `GET /users/{id}`
- `PUT|PATCH /users/{id}`
- `DELETE /users/{id}`

### Currencies
- `GET /currencies`
- `GET /currencies/{id}`
- `PUT|PATCH /currencies/{id}` (super_admin)

### Settings
- `GET /settings`
- `PUT|PATCH /settings`

Fields:
- `default_currency` (exists in currencies.code)
- `tax_percent` (0..100)

### Reports
- `GET /reports/sales`
- `GET /reports/expenses`
- `GET /reports/profit`
- `GET /reports/stock`

Optional query filters:
- `date_from`
- `date_to`
- `shop_id` (for `super_admin`)

## Pagination Pattern
List endpoints return Laravel paginator structure:
- `data`
- `links`
- `meta`

Use `?limit=20` (or another number) to control page size.

## Mobile Demo Accounts
Password for all demo users:
- `MobileTest123!`

Sellers:
- `seller.alpha.1@ck-accounting.test`
- `seller.alpha.2@ck-accounting.test`
- `seller.beta.1@ck-accounting.test`
- `seller.beta.2@ck-accounting.test`

Owners:
- `owner.alpha@ck-accounting.test`
- `owner.beta@ck-accounting.test`

Super admin:
- `admin@ck-accounting.test`
- password: `Momajon115877!`

## Security Notes for Mobile
- Sanctum token expiration is enabled by backend config.
- API sends secure headers (`X-Frame-Options`, `X-Content-Type-Options`, etc.).
- Always handle `401`, `403`, `404`, and `422` explicitly in the mobile app.
