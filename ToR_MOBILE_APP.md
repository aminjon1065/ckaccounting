# CK Accounting Mobile Application
# Terms of Reference (ToR)

Version: 1.0  
Document Type: Mobile Application Technical Specification  
Project: CK Accounting  
Platform: Android / iOS  

---

# 1. Project Overview

CK Accounting Mobile App is a client application designed for small businesses to manage their daily operations.

The application allows shop owners and sellers to manage:

- products
- inventory
- sales
- purchases
- expenses
- debts
- financial reports

The application communicates with a backend API.

---

# 2. Platform Requirements

Mobile Platform:

Android  
iOS

Recommended Framework:

React Native (Expo)

Backend Integration:

REST API

Authentication:

JWT / Sanctum

---

# 3. Target Users

The application is intended for:

Shop Owners  
Shop Sellers

The system also includes a Super Admin, but the admin panel is usually web-based.

---

# 4. User Roles

## Owner

Permissions:

- manage products
- manage purchases
- manage sales
- manage expenses
- manage debts
- manage shop users
- view reports

---

## Seller

Permissions:

- create sales
- view products
- view stock

Restrictions:

- cannot manage users
- cannot delete products
- cannot change shop settings

---

# 5. Application Architecture

The mobile application communicates with backend services.

Architecture:

Mobile App  
↓  
REST API  
↓  
Laravel Backend  
↓  
PostgreSQL

---

# 6. Authentication Flow

User login process:

1. User opens application
2. Login screen is displayed
3. User enters email and password
4. Application sends request to backend
5. Backend returns authentication token
6. Token is stored securely
7. User enters dashboard

Token must be refreshed automatically.

---

# 7. Main Navigation

The application uses a bottom navigation structure.

Main sections:

Dashboard  
Products  
Sales  
Expenses  
Reports  
Settings

---

# 8. Dashboard Screen

Purpose:

Display key financial metrics.

Displayed information:

Total sales  
Total expenses  
Profit  
Inventory value  

Additional blocks:

Low stock products  
Recent sales  

Filters:

Day  
Week  
Month  
Custom date range

---

# 9. Products Module

Purpose:

Manage product inventory.

Features:

Create product  
Edit product  
Delete product  
Search product  
View product stock  

Product fields:

Name  
Code  
Unit  
Cost price  
Sale price  
Stock quantity  
Low stock alert  

Product list should support:

Pagination  
Search  
Sorting

---

# 10. Purchases Module

Purpose:

Register incoming inventory.

Features:

Create purchase invoice  
Add purchased products  
Update product stock  

Purchase fields:

Supplier name  
Date  
Total amount  

Purchase item fields:

Product  
Quantity  
Price  
Total  

---

# 11. Sales Module

Purpose:

Record product sales.

Features:

Create sale  
Add products to sale  
Calculate total price  
Apply discount  
Record payment  
Track debt  

Sale fields:

Products  
Quantity  
Price  
Discount  
Paid amount  
Debt  

Payment methods:

Cash  
Card  
Transfer  

---

# 12. Expenses Module

Purpose:

Track operational expenses.

Features:

Add expense  
Edit expense  
Delete expense  
View expense list  

Expense fields:

Name  
Quantity  
Price  
Total  
Note  
Date  

---

# 13. Debts Module

Purpose:

Track money owed by customers or suppliers.

Features:

Create debt record  
Add debt transaction  
View debt balance  

Transaction types:

Give  
Take  
Repay  

Fields:

Person name  
Amount  
Date  
Note  

---

# 14. Reports Module

Purpose:

Provide financial insights.

Reports available:

Sales report  
Expense report  
Profit report  
Stock report  

Profit formula:

Profit =
Total Sales
-
Cost of Goods
-
Expenses

Reports must support:

Date filtering  
Export capability (future feature)

---

# 15. Settings Module

Purpose:

Manage shop configuration.

Settings include:

Default currency  
Tax percentage  

Additional features:

User profile  
Logout

---

# 16. Notifications

The application must support notifications for:

Low stock alerts  
Important system updates  

Push notifications may be implemented in future versions.

---

# 17. Offline Considerations

The application should handle temporary network loss gracefully.

Recommended approach:

Retry failed requests  
Cache last responses

---

# 18. Performance Requirements

Application should:

Load dashboard within 2 seconds  
Handle product lists up to 1000 items  
Avoid unnecessary API calls  

---

# 19. Security Requirements

All communication must use HTTPS.

Sensitive data must not be stored in plain text.

Authentication tokens must be stored securely.

---

# 20. UI/UX Requirements

The application must provide:

Simple navigation  
Clear financial indicators  
Large touch targets for POS-style usage  

The design should prioritize speed and ease of use.

---

# 21. Error Handling

Errors must be displayed clearly.

Example messages:

Network error  
Validation error  
Unauthorized access

---

# 22. Logging

The application should log:

API errors  
Crash reports  

Recommended tools:

Sentry  
Firebase Crashlytics

---

# 23. Scalability

The mobile application must support:

Multiple shops  
Multiple users per shop  

---

# 24. Future Enhancements

Possible improvements include:

Barcode scanning  
Receipt printing  
Advanced analytics  
Push notifications  
Cloud backup

---

# 25. Acceptance Criteria

The mobile application is considered complete when:

All core modules are implemented  
Authentication works correctly  
Sales and inventory calculations are accurate  
Reports display correct financial results  
The application runs smoothly on Android and iOS