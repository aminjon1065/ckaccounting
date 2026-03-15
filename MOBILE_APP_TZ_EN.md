# Technical Specification for the Mobile App

## 1. Goal

Develop a mobile app for store accounting that allows the user to quickly:

- see the current store status;
- create a sale;
- manage products and stock;
- control debts;
- add expenses;
- view basic analytics.

The app must be simple, fast, and optimized for the daily workflow of store sellers and owners.

## 2. Main Roles

### 2.1. Seller

Must have access to:

- dashboard;
- products;
- sales;
- debts;
- personal profile.

Restrictions:

- no store management;
- no user management;
- no administrative settings.

### 2.2. Owner

Must have access to everything available to the seller, plus:

- expenses;
- purchases;
- store users;
- reports;
- store settings.

### 2.3. Super Admin

For `super_admin`, the mobile app shows a **multi-shop overview screen** on login:

- list of all shops with name and number of sellers;
- tap a shop → switch context into that shop's dashboard and work as an owner.

The main administrative panel (user management, billing, etc.) remains in the web panel.

## 3. Bottom Navigation

Recommended bottom navigation items:

- `Home`
- `Products`
- `Sales`
- `Debts`
- `More`

The `More` section should contain:

- expenses;
- purchases;
- reports;
- settings;
- users;
- profile;
- logout.

## 4. Dashboard

The dashboard must be the most useful screen in the app.

### 4.1. Screen Sections

#### Top section

- store name with shop-switcher dropdown (for super_admin);
- period filter tabs: **День / Неделя / Месяц / Год / Период** — all KPI cards on the dashboard must react to this filter.

#### Main KPI cards (4 cards, 2×2 grid)

- sales / revenue (Продажи / Доход);
- cost of goods sold (Себестоимость);
- expenses (Расходы);
- net profit (Чистая прибыль).

#### Stock summary card

A single wide card showing:

- total product count (общее количество товаров);
- total stock cost value (итого себестоимость);
- total stock sales value (итого по продажным ценам).

#### Debt summary card

Two columns in one card:

- **Мне должны** (customers owe me): total amount;
- **Я должен** (I owe suppliers): total amount;
- net balance shown below as a single line.

#### Quick actions (3 buttons)

- `Приход товара` (Receive stock / New Purchase)
- `Продажа +` (New Sale)
- `Добавить расход` (Add Expense)

#### Alerts

- low stock products;
- unpaid debts.

#### Recent activity

- recent sales;
- recent expenses;
- recent debt operations.

### 4.2. Backend data

For mobile convenience, an aggregated endpoint is recommended:

- `GET /api/v1/dashboard?period={day|week|month|year|custom}&date_from=&date_to=`

Suggested response structure:

- `period_sales_total`
- `period_expenses_total`
- `period_profit`
- `period_cogs` (cost of goods sold)
- `debts_receivable` (customers owe me)
- `debts_payable` (I owe suppliers)
- `debts_net`
- `stock_total_qty`
- `stock_total_cost`
- `stock_total_sales_value`
- `low_stock_count`
- `recent_sales[]`
- `recent_expenses[]`
- `low_stock_products[]`

## 5. Products Section

This is one of the key sections of the app.

### 5.1. Product list screen

Must include:

- search;
- filters:
  - all;
  - low stock;
  - out of stock;
- product cards list.

Each product card should show:

- product image;
- name;
- code;
- current stock;
- unit;
- sale price;
- stock indicator.

### 5.2. Product details screen

Must include:

- product image;
- name;
- code;
- cost price;
- sale price;
- current stock;
- minimum stock threshold;
- actions:
  - `Edit`;
  - `Add Purchase`;
  - `View Movement`.

### 5.3. Create / edit product screen

Fields:

- image (photo picker: gallery or camera);
- name *(required)*;
- code / barcode (Артикул / штрих-код);
- unit of measure (Единица измерения);
- quantity in stock (Количество на складе);
- cost price / purchase price *(required)*;
- sale price — set via **one of three pricing modes**:
  - `%` — percentage markup over cost price (auto-calculated);
  - Fixed price (Фиксированная цена) — enter final sale price manually;
  - Manual markup (Ручная наценка) — enter markup amount in currency, auto-calculate result;
  - A **"Calculate markup"** (Рассчитать наценку) helper button must be present;
- minimum stock threshold (Порог остатка);
- **Clearance flag** (Распродаётся) — checkbox; when active, this product can be sold at a discounted / custom price during sale creation;
- notes (Заметки) — optional free-text field.

### 5.4. Backend

The current backend already provides:

- product list;
- product details;
- product creation;
- product update;
- product deletion;
- product image upload support.

Additionally, it is recommended to return:

- `is_low_stock`;
- `image_url`.

## 6. Product Movement

This should be a dedicated screen.

### 6.1. Purpose

The user must clearly see how the product came in and how it was sold out.

### 6.2. Screen structure

- product header;
- current stock;
- movement list ordered by date.

### 6.3. Each movement record should include

- date;
- operation type:
  - purchase;
  - sale;
  - correction can be added later;
- quantity;
- price;
- total;
- actor name.

### 6.4. Backend

A dedicated endpoint is needed:

- `GET /api/v1/products/{product}/movements`

Suggested response:

- `current_stock`
- `movements[]`
  - `type`
  - `quantity`
  - `price`
  - `total`
  - `created_at`
  - `reference_id`
  - `reference_type`
  - `actor_name`

Movement sources:

- `purchase_items`
- `sale_items`

## 7. Sales Section

Sales must be created as quickly as possible.

### 7.1. Sales list screen

Must include:

- customer search;
- date filter;
- sales list.

Each record should show:

- ID or number;
- customer name;
- total amount;
- paid amount;
- debt amount;
- date.

### 7.2. Create sale screen

The sale type is selected at the top: **Products** or **Services**.

#### Sale of products (Расход товара)

- date *(required)*;
- product search by name, code, or barcode;
- add products to cart; each cart item shows:
  - product name;
  - quantity (−/+);
  - price — behavior depends on the product's pricing mode:
    - **Fixed / % markup**: price is pre-filled automatically, read-only;
    - **Manual markup**: price field is editable by the seller;
    - **Clearance** (Распродаётся): price field is always editable;
  - line total (auto-calculated);
- global discount field (Скидка);
- total amount (Итого);
- paid amount (Оплачено);
- debt — auto-calculated as `total − paid`;
- notes (Заметки);
- payment type:
  - `cash`
  - `card`
  - `transfer`
- `Save` button.

#### Sale of services (Продажа услуг)

- service name (Наименование);
- unit of measure (Единица);
- quantity (Количество);
- price (Цена);
- total (Сумма);
- discount (Скидка);
- paid amount (Оплачено);
- debt (Долг — auto-calculated);
- notes (Заметки);
- `Save` button.

### 7.3. Sale details screen

Must include:

- customer;
- products list;
- quantities;
- prices;
- discount;
- paid amount;
- debt amount;
- date;
- sale author.

A **Share** (Поделиться) button must be present on this screen to export/send the receipt.

#### Receipt format

When sharing, the app generates a plain-text or simple formatted receipt containing:

- store name;
- sale date and number;
- itemized product list (name, qty, price, line total);
- discount (if any);
- total amount;
- paid amount;
- debt remainder (if any).

The receipt is shared via the system share sheet (WhatsApp, Telegram, SMS, etc.).

### 7.4. Customers / Contacts

A customer list is required to support quick selection during sale creation and debt tracking.

#### Customer list screen

- search by name or phone;
- customer list showing: name, phone, total outstanding debt balance;
- `Add customer` button.

#### Customer card / form

Fields:

- name *(required)*;
- phone number;
- notes.

#### Integration points

- Sale creation: customer field uses the contact list for auto-fill / quick selection;
- Debts section: debt records link to a customer contact, showing their full transaction history in one place.

#### Backend

Recommended endpoints:

- `GET /api/v1/customers` — list with search
- `POST /api/v1/customers` — create
- `PATCH /api/v1/customers/{id}` — update
- `GET /api/v1/customers/{id}` — detail with debt summary

### 7.5. Return / Refund (Возврат)

Allows reversing a completed sale — either fully or partially.

#### Return form

Fields:

- link to original sale (search by sale ID or customer);
- list of items from the original sale with a quantity field for each (how many to return);
- return reason (Причина возврата) — free text;
- refund method: cash / card / transfer / offset against debt;
- `Save` button.

#### Logic

- Returned stock quantity is restored to inventory automatically;
- If a refund is issued, the paid amount decreases accordingly;
- If the sale had a debt balance, a return reduces or cancels it;
- The return is recorded in product movement history with type `return`.

#### Access

- `owner` and `super_admin` only; sellers cannot create returns.

#### Backend

Recommended endpoint:

- `POST /api/v1/sales/{sale}/return`
  - body: `{ items: [{ product_id, quantity }], reason, refund_method }`

## 8. Debts Section

This is one of the central sections of the app.

### 8.1. Debt list screen

Must include:

- search by person name;
- filters:
  - all;
  - active;
  - closed;
- debt records list.

Each record should show:

- person name;
- balance;
- last operation;
- date.

### 8.2. Debt details screen

Must include:

- person name;
- current balance;
- transaction history (list of operations with date, amount, note);
- two action buttons:
  - **Дать долг ↑** (Give / add debt) — increases the balance;
  - **Взять долг ↓** (Receive / repay debt) — decreases the balance;
- each operation form contains: amount (Сумма), date (Дата), note (Заметка).

### 8.3. Status logic

The app should display:

- `active debt`;
- `closed`.

### 8.4. Transaction logic

- `give` increases debt;
- `repay` decreases debt;
- `take` decreases debt through return or reverse operation.

## 9. Expenses Section

This section is especially important for the `owner`.

### 9.1. Expenses list screen

Must include:

- search;
- date filter;
- expenses list.

Each record should show:

- name;
- quantity;
- price;
- total;
- date.

### 9.2. Create expense screen

Fields:

- name;
- quantity;
- price;
- note.

### 9.3. Future recommendation

Later, expense categories should be added:

- rent;
- delivery;
- utilities;
- salary;
- other.

## 10. Purchases Section

This is the owner-side inbound stock section.

### 10.1. Purchases list screen

Each record shows:

- date;
- supplier name;
- total amount;
- number of line items (positions).

A **Share** (Поделиться) button must be available on the purchase detail screen to export/share the purchase document.

### 10.2. Create purchase screen

The purchase is entered as a table with columns:

| # | Name / Code / Barcode | Unit | Qty | Price | Total |
|---|---|---|---|---|---|

Fields at the top:

- date *(required)*;
- supplier name.

Footer row shows **Итого** (grand total).

### 10.3. Important logic

- After a purchase is created, product stock is updated automatically.
- If a new product is being received for the first time, it can optionally be created inline from the purchase screen.

## 11. Reports Section

On mobile, reports should stay lightweight and easy to understand.

### 11.1. Minimum report set

- sales;
- expenses;
- profit;
- stock;
- low stock;
- debts.

### 11.2. Filters

- today;
- 7 days;
- 30 days;
- custom period.

### 11.3. Format

Recommended format:

- KPI cards;
- one simple chart;
- one list of key problem points.

Complex BI-style analytics should not overload the mobile UI.

## 12. Stock Write-off (Списание товара)

This is a dedicated feature for removing stock that was lost, damaged, or consumed internally.

### 12.1. Purpose

The owner or authorized user can manually reduce the stock of a product without creating a sale. The reason is logged for audit purposes.

### 12.2. Write-off form

Fields:

- product name (search by name or code);
- quantity to write off (Количество);
- notes / reason (Заметка);
- `Save` button.

### 12.3. Logic

- Stock quantity is reduced immediately on save.
- The write-off is recorded in the product movement history with type `write_off`.
- Access: `owner` and `super_admin` only.

### 12.4. Backend

Recommended endpoint:

- `POST /api/v1/products/{product}/write-off`
  - body: `{ quantity, note }`

### 12.5. Seller report (Отчёт продавца)

A lightweight report available to sellers showing their own performance:

- total number of products sold (Количество проданных товаров);
- total sales amount (Сумма продаж);
- can be toggled between showing percentage contribution and absolute value.

## 13. More Section

Must include:

- profile;
- settings;
- users;
- currency;
- store;
- **write-off** (Списание) — owner only;
- logout.

For `seller`, the list must be shorter and should exclude owner/admin features.

## 14. UI/UX Requirements

### 14.1. General principles

The interface must be:

- fast;
- clear;
- minimal;
- focused on frequent daily actions.

### 14.2. Rules

- minimal nesting;
- minimal heavy tables;
- more cards and large CTA buttons;
- important numbers must be visible immediately;
- the dashboard should contain only essential information;
- product images should be used in product lists and product details;
- sale creation must require as few steps as possible.

## 15. What already exists in the backend

The current backend already provides a solid base for:

- authentication;
- shops;
- users;
- products;
- sales;
- purchases;
- expenses;
- debts;
- reports;
- product image upload.

## 16. Recommended backend additions

For a better mobile UX, the following endpoints are recommended:

- `GET /api/v1/dashboard?period=&date_from=&date_to=` (with debt split + stock summary)
- `GET /api/v1/products/{product}/movements`
- `GET /api/v1/products?filter=low_stock` or equivalent
- `POST /api/v1/products/{product}/write-off`
- `POST /api/v1/sales` — support service type via a `type` field (`product` | `service`)
- `GET /api/v1/debts/summary` (receivable vs payable totals)

## 17. Development Priority

### Phase 1

- login;
- dashboard (with period filter + split debt card + stock summary);
- products (with pricing modes and clearance flag);
- product details;
- sales of products;
- debts (with give/take buttons).

### Phase 2

- expenses;
- purchases (table view + share);
- product movement;
- service sales;
- simple report;
- **customer / contacts list** — with sale auto-fill and debt linking;
- **sale receipt sharing** — share button on sale details generating plain-text receipt for WhatsApp/Telegram.

### Phase 3

- stock write-off (списание);
- **return / refund** — partial or full return with stock restoration and payment reversal;
- seller report;
- users management;
- store settings;
- advanced reports;
- **barcode camera scanner** — scan product barcodes via camera on sale creation, purchase entry, and product lookup (replaces manual barcode typing).

## 18. Final MVP Scope

For the first complete version, the recommended screen set is:

- login;
- dashboard (with period filter, split debts, stock summary);
- products (with 3 pricing modes);
- product details;
- product movement;
- sales (products + services + receipt sharing);
- customers / contacts;
- debts;
- expenses;
- purchases;
- stock write-off;
- return / refund;
- `More` section.

This scope covers the main daily store workflow and matches the client expectations from the provided sketches and references.
