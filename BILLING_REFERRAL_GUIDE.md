# DTG Panel - Billing & Referral System Documentation

## Overview

This documentation covers the new billing system, referral code system, and associated features added to DTG Panel.

---

## Features Added

### 1. Referral Code System

The referral code system allows admins to create promotional codes that users can claim to earn credits.

#### Admin Features:
- **Create Referral Codes**: Generate new referral codes with configurable credits and limits
- **Manage Codes**: Edit or delete existing referral codes
- **Track Usage**: View how many times each code has been claimed

#### Admin Routes:
- `GET /admin/referral-codes` - View all referral codes
- `POST /admin/referral-codes/create` - Create new referral code
- `POST /admin/referral-codes/:id/edit` - Edit referral code
- `POST /admin/referral-codes/:id/delete` - Delete referral code

#### Code Parameters:
- **Code**: Unique identifier (auto-converted to uppercase)
- **Name**: Display name for the referral code
- **Description**: Optional description
- **Credits**: Number of credits users receive when claiming
- **Max Claims**: Limit on how many times the code can be used (0 = unlimited)
- **Expiry Date**: Optional expiration date
- **Status**: Active or Inactive

#### User Features:
- **Claim Codes**: Users can claim referral codes on the `/referral` page
- **View History**: See all claimed referral codes and credits earned
- **Restrictions**: Users can only claim each code once

#### User Routes:
- `GET /referral` - View referral page and claimed codes
- `POST /api/referral/claim` - Claim a referral code

---

### 2. Billing Categories

Billing categories help organize server packages into logical groups.

#### Admin Features:
- **Create Categories**: Create categories with custom icons and colors
- **Organize Packages**: Link server packages to categories
- **Display Order**: Control the order categories appear

#### Admin Routes:
- `GET /admin/billing-categories` - View all billing categories
- `POST /admin/billing-categories/create` - Create new category
- `POST /admin/billing-categories/:id/edit` - Edit category
- `POST /admin/billing-categories/:id/delete` - Delete category

#### Category Parameters:
- **Name**: Category name (must be unique)
- **Description**: Optional description
- **Icon**: Font Awesome icon class (e.g., `fas fa-gamepad`)
- **Color**: Hex color code for the icon
- **Display Order**: Sort order (lower numbers appear first)
- **Status**: Active or Inactive

---

### 3. Server Packages

Server packages are templates that users can purchase to create new servers.

#### Admin Features:
- **Create Packages**: Define server templates with specifications and pricing
- **Assign Categories**: Organize packages by category
- **Flexible Pricing**: Set credit cost or mark as free
- **Auto-Renewal**: Optional automatic renewal feature

#### Admin Routes:
- `GET /admin/server-packages` - View all server packages
- `POST /admin/server-packages/create` - Create new package
- `POST /admin/server-packages/:id/edit` - Edit package
- `POST /admin/server-packages/:id/delete` - Delete package

#### Package Parameters:
- **Name**: Package name
- **Description**: Optional description
- **Version**: Minecraft version (e.g., 1.20.1)
- **Software**: Server software (Paper, Spigot, Purpur, etc.)
- **RAM**: Memory in MB
- **CPU**: Number of CPU cores
- **Disk**: Storage in MB
- **Credits Cost**: Cost in credits (0 for free)
- **Max Players**: Maximum players allowed
- **Expiry Days**: Server duration in days
- **Auto-Renewal**: Allow automatic renewal
- **Category**: Link to a billing category
- **Status**: Active or Inactive

---

### 4. User Credits System

All users have a credit balance that can be used to purchase servers.

#### Features:
- **Credit Balance**: Each user has a wallet with credits
- **Auto-Initialize**: Credits are automatically initialized when users are created
- **Transaction History**: All credit transactions are logged
- **Credit Updates**: Credits update in real-time when claimed or spent

#### Routes:
- `GET /api/user/credits` - Get current credit balance

#### Credit Types:
- Referral claims (add credits)
- Server purchases (deduct credits)
- Transactions are logged with descriptions

---

### 5. Billing Panel (User)

Users can view and purchase server packages using credits.

#### Features:
- **View Balance**: Display current credit balance
- **Browse Packages**: See all available server packages
- **Flip Card Animation**: Hover over packages to see management options
- **Quick Purchase**: One-click server purchase with confirmation
- **Transaction History**: View all billing transactions

#### Page: `/billing`

#### Display Information:
- Current credit balance
- Total spending (lifetime)
- Active servers count
- Available server packages with specs
- Transaction history

#### Flip Card Features:
- **Front**: Package details and pricing
- **Back**: Purchase, Details, and Back buttons
- **Desktop**: Hover to flip
- **Mobile**: Click to flip

---

### 6. Referral Panel (User)

Users can claim referral codes to earn credits.

#### Features:
- **Claim Codes**: Enter a referral code to earn credits
- **Validation**: Verify code exists, hasn't expired, and user hasn't already claimed it
- **View History**: See all claimed codes and credits
- **Total Earned**: Display total referral credits earned

#### Page: `/referral`

---

## Database Schema

### New Tables Created:

#### `referral_codes`
```sql
- id (INTEGER PRIMARY KEY)
- code (TEXT UNIQUE)
- name (TEXT)
- description (TEXT)
- credits (INTEGER)
- max_claims (INTEGER)
- current_claims (INTEGER)
- expiry_date (DATETIME)
- status (TEXT: 'active'/'inactive')
- created_by (INTEGER FK -> users.id)
- created_at (DATETIME)
- updated_at (DATETIME)
```

#### `referral_claims`
```sql
- id (INTEGER PRIMARY KEY)
- code_id (INTEGER FK -> referral_codes.id)
- user_id (INTEGER FK -> users.id)
- credits_received (INTEGER)
- claimed_at (DATETIME)
- UNIQUE(code_id, user_id)
```

#### `user_credits`
```sql
- id (INTEGER PRIMARY KEY)
- user_id (INTEGER FK -> users.id) UNIQUE
- balance (DECIMAL)
- currency (TEXT: default 'USD')
- created_at (DATETIME)
- updated_at (DATETIME)
```

#### `billing_transactions`
```sql
- id (INTEGER PRIMARY KEY)
- user_id (INTEGER FK -> users.id)
- transaction_type (TEXT)
- amount (DECIMAL)
- description (TEXT)
- server_id (INTEGER FK -> servers.id)
- status (TEXT: 'completed')
- metadata (TEXT JSON)
- created_at (DATETIME)
```

#### `billing_categories`
```sql
- id (INTEGER PRIMARY KEY)
- name (TEXT UNIQUE)
- description (TEXT)
- icon (TEXT)
- color (TEXT)
- display_order (INTEGER)
- status (TEXT: 'active'/'inactive')
- created_by (INTEGER FK -> users.id)
- created_at (DATETIME)
- updated_at (DATETIME)
```

#### `server_packages`
```sql
- id (INTEGER PRIMARY KEY)
- name (TEXT)
- description (TEXT)
- version (TEXT)
- software (TEXT)
- ram (INTEGER)
- cpu (INTEGER)
- disk (INTEGER)
- credits_cost (INTEGER)
- is_free (BOOLEAN)
- auto_renewal (BOOLEAN)
- renewal_credits (INTEGER)
- expiry_days (INTEGER)
- max_players (INTEGER)
- category_id (INTEGER FK -> billing_categories.id)
- status (TEXT: 'active'/'inactive')
- created_at (DATETIME)
- updated_at (DATETIME)
```

#### `user_servers_purchased`
```sql
- id (INTEGER PRIMARY KEY)
- user_id (INTEGER FK -> users.id)
- package_id (INTEGER FK -> server_packages.id)
- server_id (INTEGER FK -> servers.id)
- credits_paid (INTEGER)
- purchase_date (DATETIME)
- expiry_date (DATETIME)
- auto_renewal (BOOLEAN)
- status (TEXT: 'active')
- metadata (TEXT JSON)
```

---

## Navigation Updates

### Admin Sidebar (New Section: Billing & Marketing)
- **Referral Codes** - Manage promotional codes
- **Categories** - Organize server packages
- **Server Packages** - Create/manage packages

### User Sidebar (New Section: Billing & Credits)
- **Billing Panel** - View balance and purchase servers
- **Referral Codes** - Claim promotional codes

---

## Testing Checklist

### Admin Functions:
- [ ] Create a new referral code
- [ ] Edit an existing referral code
- [ ] Delete a referral code
- [ ] Verify code claims are tracked
- [ ] Create a billing category
- [ ] Edit a billing category
- [ ] Delete a billing category
- [ ] Create a server package
- [ ] Assign package to a category
- [ ] Edit a server package
- [ ] Delete a server package
- [ ] Set a free server package
- [ ] Set a paid server package with credits

### User Functions:
- [ ] Navigate to Referral page
- [ ] Claim a valid referral code
- [ ] Verify credits are added
- [ ] Try to claim the same code twice (should fail)
- [ ] Try to claim an expired code (should fail)
- [ ] Navigate to Billing panel
- [ ] View available server packages
- [ ] Hover over a package card (should flip)
- [ ] Click on a package card (mobile)
- [ ] Purchase a free server package
- [ ] Try to purchase a paid server without enough credits (should fail)
- [ ] Purchase a paid server with enough credits
- [ ] View transaction history
- [ ] Verify credit balance is updated

### Animation Testing:
- [ ] Desktop: Hover over server card triggers flip
- [ ] Desktop: Hover away stops flip
- [ ] Mobile: Click card triggers flip
- [ ] Mobile: Click back button triggers flip back
- [ ] Animation smooth on all browsers

---

## API Endpoints

### Referral Management
```
POST /api/referral/claim
Body: { code: "CODE123" }
Response: { success: true, credits: 100, message: "..." }
```

### Billing
```
POST /api/billing/purchase-server
Body: { package_id: 1 }
Response: { success: true, purchase_id: 123, remaining_credits: 400 }

GET /api/user/credits
Response: { success: true, balance: 500, currency: "USD" }
```

---

## Configuration

### Environment Variables
No new environment variables required. The system uses existing database and authentication.

### Database Initialization
The system automatically:
1. Creates new tables on first run
2. Initializes user_credits for existing users
3. Handles migrations for existing installations

---

## Troubleshooting

### Credits Not Showing
- Ensure user_credits table was created
- Check database for user_credits entries
- Try refreshing the page

### Referral Code Not Working
- Verify code is in UPPERCASE
- Check expiry_date hasn't passed
- Verify max_claims limit hasn't been reached
- Confirm user hasn't already claimed it

### Flip Animation Not Working
- Clear browser cache
- Check CSS is properly loaded
- Verify JavaScript is enabled
- Test on different browser

### Packages Not Showing
- Verify packages have status = 'active'
- Check category assignments (optional)
- Ensure credits are initialized for user

---

## Future Enhancement Ideas

1. PayPal/Stripe integration for credit purchase
2. Admin dashboard showing referral statistics
3. User affiliate system
4. Package upgrade/downgrade paths
5. Scheduled server expiry notifications
6. Bulk referral code generation
7. Credit transfer between users
8. Subscription-based server packages
9. Discount/coupon system
10. Audit logs for all transactions

---

## Support

For issues or feature requests, please refer to the project's issue tracker.

Version: 1.0.0
Last Updated: 2026-09-13
