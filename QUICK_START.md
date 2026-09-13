# DTG Panel - Quick Start Guide for New Features

## 🚀 Getting Started

### What's New

Your DTG Panel now includes a complete billing and referral system with the following features:

1. **Referral Code System** - Promote your panel with discount codes
2. **Billing Categories** - Organize server packages by type
3. **Server Packages** - Create and sell server templates
4. **User Credits** - Virtual currency for purchasing servers
5. **Billing Panel** - User-friendly interface for server purchases
6. **Flip Card Animations** - Interactive card animations for better UX

---

## 📋 Quick Setup Steps

### Step 1: Start the Application

```bash
cd amcpanel
npm start
```

The app will:
- Create new database tables automatically
- Initialize user credits for existing users
- Run on http://localhost:3000

### Step 2: Access Admin Panel

1. Login with your admin credentials
2. Go to **Admin Panel** → **Billing & Marketing**

---

## 🏷️ Creating Referral Codes (Admin)

### Navigate to Referral Codes
- **Admin Panel** → **Billing & Marketing** → **Referral Codes**

### Create a Code
1. Click **New Referral Code** button
2. Fill in the form:
   - **Code**: Enter uppercase code (e.g., `WELCOME100`)
   - **Name**: Display name (e.g., "Welcome Bonus")
   - **Credits**: Amount to award (e.g., `100`)
   - **Max Claims**: Limit (0 = unlimited)
   - **Expiry Date**: Optional expiration date

### Example Codes to Try
```
Code: WELCOME100 | Credits: 100
Code: NEWUSER50 | Credits: 50 | Max Claims: 100
Code: PROMO25 | Credits: 25 | Expiry: 2026-12-31
```

---

## 🎨 Managing Categories (Admin)

### Navigate to Categories
- **Admin Panel** → **Billing & Marketing** → **Categories**

### Create a Category
1. Click **New Category** button
2. Fill in:
   - **Name**: e.g., "Gaming Servers", "Development"
   - **Icon**: Font Awesome class (e.g., `fas fa-gamepad`)
   - **Color**: Pick a color for the icon
   - **Display Order**: Lower numbers appear first

### Example Categories
```
Gaming Servers | Icon: fas fa-gamepad | Color: #ff6b6b
Development | Icon: fas fa-laptop-code | Color: #4ecdc4
Testing | Icon: fas fa-flask | Color: #ffd93d
```

---

## 📦 Creating Server Packages (Admin)

### Navigate to Server Packages
- **Admin Panel** → **Billing & Marketing** → **Server Packages**

### Create a Package
1. Click **New Server Package** button
2. Fill in basic info:
   - **Name**: e.g., "Starter Server"
   - **Version**: e.g., "1.20.1"
   - **Software**: e.g., "Paper"

3. Set specifications:
   - **RAM**: 1024 MB minimum
   - **CPU**: 1 core minimum
   - **Disk**: 1024 MB minimum
   - **Max Players**: e.g., 20

4. Set pricing:
   - Choose **Free** or **Credits**
   - If Credits: Enter cost (e.g., 50 credits)
   - Optional: Enable auto-renewal

### Example Packages

#### Free Package
```
Name: Free Trial
Version: 1.20.1
Software: Paper
RAM: 512 MB
CPU: 1
Disk: 2048 MB
Cost: FREE
Duration: 7 days
```

#### Starter Package (50 credits)
```
Name: Starter Server
Version: 1.20.1
Software: Paper
RAM: 2048 MB
CPU: 2
Disk: 10240 MB
Cost: 50 Credits
Duration: 30 days
```

#### Pro Package (150 credits)
```
Name: Pro Server
Version: 1.20.1
Software: Paper
RAM: 4096 MB
CPU: 4
Disk: 20480 MB
Cost: 150 Credits
Duration: 30 days
Auto-Renewal: Yes (100 credits)
```

---

## 👥 User Features (For Your Users)

### Claiming Referral Codes

1. Navigate to **Profile** → **Referral Codes**
2. Enter a referral code in the text field
3. Click **Claim Code**
4. Credits are instantly added to their balance

### Viewing Credit Balance

- Check balance in **Billing Panel** → Credit card at top
- Current balance: `💰 XXX USD`

### Purchasing Servers

1. Go to **Profile** → **Billing Panel**
2. Browse available server packages
3. **Click on a card** to see options:
   - Purchase button
   - Details button
   - Back button

4. Click **Purchase** to buy the server
5. Confirm the purchase
6. Server is created and allocated to the user

### Animation Tips for Users
- **Desktop**: Hover over cards to see flip animation
- **Mobile**: Tap cards to flip and see options
- Cost and details appear on card back

---

## 🧪 Testing Checklist

### As Admin:
- [ ] Create a referral code
- [ ] Create a billing category
- [ ] Create a free server package
- [ ] Create a paid server package

### As User:
- [ ] Claim a referral code
- [ ] Check credit balance increased
- [ ] Go to Billing Panel
- [ ] See all available packages
- [ ] Flip a card (hover or click)
- [ ] Purchase a free server
- [ ] Purchase a paid server (if you have credits)
- [ ] Check transaction history

### Browser Testing:
- [ ] Desktop Chrome
- [ ] Firefox
- [ ] Mobile Safari
- [ ] Mobile Chrome

---

## 💡 Pro Tips

### For Admins

1. **Create promotional tiers:**
   - New users: 100 credit welcome code
   - Referrers: 50 credit code per referral
   - Seasonal: Time-limited bonus codes

2. **Organize packages by category:**
   - Gaming (high-powered servers)
   - Development (low-cost test servers)
   - Production (premium packages)

3. **Set expiry dates strategically:**
   - Use short expiry for flash sales
   - Use long/no expiry for permanent offers
   - Limit max_claims for exclusive codes

4. **Monitor usage:**
   - Check referral claims count
   - Track transaction history
   - Watch for abuse patterns

### For Users

1. **Maximize credits:**
   - Look for referral codes regularly
   - Check expiry dates on codes
   - Use credits for the package you need

2. **Choose right package:**
   - Start with free trial to test
   - Upgrade to starter for 20-player server
   - Use pro for production servers

3. **Enable auto-renewal:**
   - Keep your server running automatically
   - Cheaper to renew than purchase new

---

## 🔧 API Endpoints (For Developers)

### Claim Referral Code
```
POST /api/referral/claim
Content-Type: application/json

{
  "code": "WELCOME100"
}

Response:
{
  "success": true,
  "message": "Successfully claimed! You received 100 credits.",
  "credits": 100
}
```

### Purchase Server
```
POST /api/billing/purchase-server
Content-Type: application/json

{
  "package_id": 1
}

Response:
{
  "success": true,
  "message": "Server package \"Starter Server\" purchased successfully!",
  "purchase_id": 123,
  "remaining_credits": 450
}
```

### Get Credit Balance
```
GET /api/user/credits

Response:
{
  "success": true,
  "balance": 500,
  "currency": "USD"
}
```

---

## ❓ FAQ

### Q: How do users earn credits?
**A:** By claiming referral codes. You (the admin) create codes that award credits when claimed.

### Q: Can I sell credits for real money?
**A:** Currently, credits are earned through referral codes only. For PayPal/Stripe integration, this would be a future enhancement.

### Q: What happens when a code expires?
**A:** Users cannot claim expired codes. Codes with status=inactive also cannot be claimed.

### Q: Can users transfer credits?
**A:** Not in the current version. This would be a future feature.

### Q: What if a user runs out of credits?
**A:** They cannot purchase paid packages, but can still claim more referral codes or purchase credits (if PayPal integration is added).

### Q: How do I organize packages?
**A:** Use billing categories. Packages assigned to categories can be filtered and organized.

### Q: Can packages be free?
**A:** Yes! Check the "Free Server" option when creating a package to make it cost 0 credits.

---

## 📞 Support

### If Something Breaks:
1. Check the console logs: `tail -f /tmp/app.log`
2. Verify database: `sqlite3 database.db ".tables"`
3. Restart the app: `npm start`

### Common Issues:

**Credits not showing:**
- Restart the app (reloads user credits)
- Check database: `sqlite3 database.db "SELECT * FROM user_credits"`

**Animation not working:**
- Clear browser cache (Ctrl+Shift+Delete)
- Try different browser
- Check browser console for errors (F12)

**Code won't claim:**
- Verify code is uppercase
- Check if user already claimed it
- Verify expiry date hasn't passed
- Verify max_claims limit

---

## 🎉 You're Ready!

Your panel now has a complete billing system. Users can:
- ✅ Earn credits from referral codes
- ✅ View their credit balance
- ✅ Purchase servers with credits
- ✅ Enjoy smooth flip card animations
- ✅ Track all transactions

Happy hosting! 🚀

---

**For Detailed Documentation:** See [BILLING_REFERRAL_GUIDE.md](./BILLING_REFERRAL_GUIDE.md)
