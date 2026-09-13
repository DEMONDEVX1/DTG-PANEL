# DTG Panel 2.0 - Quick Start & Testing Guide

## 🚀 Quick Start

### Prerequisites
- Node.js v14+ 
- npm v6+
- SQLite3 (included with Node.js module)

### Installation & Setup

1. **Navigate to project directory**
```bash
cd /workspaces/DTG-PANEL/amcpanel
```

2. **Install dependencies** (already done)
```bash
npm install
```

3. **Start the server**
```bash
PORT=3000 NODE_ENV=production npm start
```

4. **Access the panel**
```
http://localhost:3000
```

---

## 🧪 Testing Guide

### Step 1: Admin Login
1. Start the server
2. Go to http://localhost:3000
3. Click "Sign In"
4. Username: `admin`
5. Password: Check your `.env` file for `ADMIN_PASSWORD` (default: `admin`)

### Step 2: Test Referral Codes (Admin)
1. In sidebar, click **Admin Panel** → **Referral Codes**
2. Click **"New Referral Code"**
3. Fill in:
   - **Code**: `WELCOME2024`
   - **Name**: `Welcome Bonus`
   - **Description**: `Get 100 credits for joining`
   - **Credits**: `100`
   - **Max Claims**: `0` (unlimited)
   - **Expiry Date**: Leave empty
4. Click **"Save Code"**
5. ✅ You should see the code in the list

### Step 3: Test Server Packages (Admin)
1. In sidebar, click **Admin Panel** → **Server Packages**
2. Click **"New Server Package"**
3. Fill in:
   - **Package Name**: `Starter Server`
   - **Version**: `1.20.1`
   - **Software**: `Paper`
   - **RAM**: `2048` MB
   - **CPU Cores**: `2`
   - **Disk**: `10240` MB
   - **Max Players**: `20`
   - **Pricing**: `Paid with Credits`
   - **Cost**: `50` Credits
   - **Expiry Days**: `30`
4. Click **"Save Package"**
5. ✅ Package should appear in the list

### Step 4: Create Test User
1. In sidebar, click **Admin Panel** → **Users**
2. Click **"Create User"**
3. Fill in:
   - **Username**: `testuser`
   - **Email**: `test@example.com`
   - **Password**: `password123`
   - **Role**: `User`
4. Click **"Create User"**
5. ✅ User should be created

### Step 5: Test as Regular User
1. Logout (bottom of sidebar)
2. Login as:
   - Username: `testuser`
   - Password: `password123`
3. You should see the dashboard

### Step 6: Test Referral Code Claiming (User)
1. Click **Referral Codes** in sidebar
2. Enter code: `WELCOME2024`
3. Press Enter or click **"Claim Code"**
4. ✅ Should see success message: "Successfully claimed! You received 100 credits."
5. Check sidebar - should show in "Claimed Codes" section
6. View **Billing Panel** - credit balance should show `100`

### Step 7: Test Server Purchase (User)
1. Click **Billing Panel** in sidebar
2. You should see:
   - Credit Balance: `💰 100 USD`
   - Available packages: "Starter Server"
3. Click **"Purchase"** on the Starter Server package
4. Confirm the purchase
5. ✅ Should see: "Server package purchased successfully!"
6. Credit balance should decrease to `50`
7. Check **Transaction History** - should show the purchase

### Step 8: Test Insufficient Credits
1. Try to claim another code with high credit value:
   - Create new code: `PREMIUM`, Cost: `1000` credits
   - Try to claim it
   - ✅ Should show: "Insufficient credits"
2. Or try to purchase a package with insufficient credits
   - ✅ Should show error message

---

## 🐛 Common Issues & Solutions

### Issue: "Database table already exists"
**Solution**: This is normal on first run. The tables are only created if they don't exist.

### Issue: "Authentication required" when accessing /billing
**Solution**: Make sure you're logged in. If not, login first at `/auth/login`

### Issue: "Package not found or inactive"
**Solution**: Make sure the server package status is set to "active" (default)

### Issue: "Invalid or expired referral code"
**Solution**: 
- Check the code is spelled correctly (case-insensitive)
- Verify the code hasn't expired
- Verify the code is set to "active"
- Check if max claims limit has been reached

### Issue: Credits not showing up
**Solution**:
- Refresh the page (Ctrl+F5)
- Make sure you're looking at the right user account
- Check the database directly: `sqlite3 database.db "SELECT balance FROM user_credits WHERE user_id = <user_id>;"`

---

## 📊 Database Queries for Testing

### Check User Credits
```bash
sqlite3 database.db "SELECT u.username, uc.balance FROM users u LEFT JOIN user_credits uc ON u.id = uc.user_id;"
```

### View All Referral Codes
```bash
sqlite3 database.db "SELECT * FROM referral_codes;"
```

### View Referral Claims
```bash
sqlite3 database.db "SELECT u.username, rc.code, rc.credits FROM referral_claims rcl JOIN referral_codes rc ON rcl.code_id = rc.id JOIN users u ON rcl.user_id = u.id;"
```

### View All Server Packages
```bash
sqlite3 database.db "SELECT name, software, version, ram, cpu, disk, credits_cost, is_free FROM server_packages;"
```

### View Purchase History
```bash
sqlite3 database.db "SELECT u.username, sp.name, usp.credits_paid, usp.purchase_date FROM user_servers_purchased usp JOIN users u ON usp.user_id = u.id JOIN server_packages sp ON usp.package_id = sp.id;"
```

### View All Transactions
```bash
sqlite3 database.db "SELECT u.username, bt.transaction_type, bt.amount, bt.description, bt.status FROM billing_transactions bt JOIN users u ON bt.user_id = u.id ORDER BY bt.created_at DESC LIMIT 20;"
```

---

## 🔍 Verification Checklist

### Before Publishing:
- [ ] Admin can create referral codes
- [ ] Admin can create server packages
- [ ] Users can see referral page
- [ ] Users can see billing panel
- [ ] Users can claim valid codes
- [ ] Users cannot claim same code twice
- [ ] Users cannot claim expired codes
- [ ] Users can purchase packages
- [ ] Users cannot purchase without enough credits
- [ ] Credit deductions work correctly
- [ ] Transaction history shows all activities
- [ ] No console errors on page load
- [ ] No database errors in logs
- [ ] Navigation links work properly
- [ ] Sidebar shows correct menu items
- [ ] Mobile responsive (test on mobile browser)

### Performance Tests:
- [ ] Page loads in < 2 seconds
- [ ] Database queries are fast
- [ ] No memory leaks (run for 5 min)
- [ ] Can handle multiple concurrent users

---

## 📱 Mobile Testing

1. Open browser DevTools (F12)
2. Click "Toggle device toolbar" (Ctrl+Shift+M)
3. Select "iPhone 12" or similar device
4. Test:
   - Can navigate to all pages
   - Buttons are clickable
   - Forms are usable
   - Cards display properly
   - Tables scroll horizontally if needed

---

## 🚨 Emergency Debug Mode

If something breaks, enable verbose logging:

```bash
cd /workspaces/DTG-PANEL/amcpanel
DEBUG=* npm start
```

This will show detailed logs of:
- Database operations
- HTTP requests
- Session management
- Error stack traces

---

## 📦 Deployment Checklist

Before going live:

1. **Security**
   - [ ] Change admin password in `.env`
   - [ ] Set `COOKIE_SECURE=true` in `.env`
   - [ ] Set `NODE_ENV=production` in `.env`
   - [ ] Use strong SESSION_SECRET

2. **Performance**
   - [ ] Enable compression (already enabled)
   - [ ] Test with 100+ concurrent users
   - [ ] Monitor memory usage

3. **Backups**
   - [ ] Create database backup
   - [ ] Backup `.env` file
   - [ ] Document server configuration

4. **Monitoring**
   - [ ] Setup error logging
   - [ ] Setup uptime monitoring
   - [ ] Setup email alerts

5. **Testing**
   - [ ] Test all features one more time
   - [ ] Test on staging server
   - [ ] Get user feedback

---

## 🎯 Next Steps After Deployment

1. **Monitor Logs**
   - Watch for errors in first 24 hours
   - Monitor database disk usage

2. **User Feedback**
   - Gather feedback from users
   - Fix bugs reported

3. **Analytics**
   - Track referral code usage
   - Monitor server package sales
   - Track user spending patterns

4. **Scaling**
   - If traffic is high, optimize queries
   - Consider database indexing
   - Setup caching if needed

---

## 📞 Support Information

### Getting Help:
1. Check logs: `tail -f /path/to/app.log`
2. Check database: Use queries above
3. Check browser console: F12 → Console tab
4. Check network requests: F12 → Network tab

### Reporting Issues:
Include:
- Error message from console
- Steps to reproduce
- Expected vs actual behavior
- Database query results

---

**Testing Version**: 2.0.0  
**Last Updated**: September 12, 2026  
**Status**: Ready for QA and Testing
