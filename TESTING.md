# Testing Guide - Tracker26

A step-by-step guide to test all features of your Tracker26 application.

## 🧪 Pre-Testing Setup

1. **Ensure Database is Set Up**
   ```bash
   npx prisma db push
   npm run seed  # Optional: adds sample data
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Open Browser**
   - Navigate to [http://localhost:3000](http://localhost:3000)

## ✅ Feature Testing Checklist

### 1. Dashboard (/)
- [ ] App redirects from `/` to `/dashboard`
- [ ] Dashboard loads without errors
- [ ] Summary cards display:
  - [ ] Month Income
  - [ ] Month Expenses
  - [ ] Net (Month)
  - [ ] Total Debt
  - [ ] Savings Goals
- [ ] Charts render correctly:
  - [ ] Expenses by Category (Pie Chart)
  - [ ] Income vs Expenses (Bar Chart)
- [ ] Recent Transactions table displays
- [ ] All numbers format as currency (e.g., $1,234.56)

### 2. Categories (/categories)
- [ ] Page loads with navigation working
- [ ] "Add Category" button opens modal
- [ ] Create new category:
  - [ ] Enter name
  - [ ] Select type (Income/Expense/Both)
  - [ ] Choose color
  - [ ] Add emoji icon
  - [ ] Submit form
  - [ ] Success: Modal closes, category appears in list
- [ ] Edit category:
  - [ ] Click edit icon
  - [ ] Form pre-fills with existing data
  - [ ] Make changes
  - [ ] Save successfully
- [ ] Delete category:
  - [ ] Try deleting category without transactions (should succeed)
  - [ ] Try deleting category with transactions (should show error)
- [ ] Table displays:
  - [ ] Category name with icon
  - [ ] Type badge
  - [ ] Transaction count
  - [ ] Edit/Delete buttons

### 3. Accounts (/accounts)
- [ ] Page loads successfully
- [ ] Total Balance card displays sum of all accounts
- [ ] "Add Account" button opens modal
- [ ] Create new account:
  - [ ] Enter name
  - [ ] Select type (Checking/Savings/Cash/Credit Card/Investment)
  - [ ] Add institution (optional)
  - [ ] Enter starting balance
  - [ ] Submit form
- [ ] Account cards display:
  - [ ] Account name and type
  - [ ] Institution name (if provided)
  - [ ] Current balance
  - [ ] Starting balance
  - [ ] Transaction count
- [ ] Edit account works
- [ ] Delete account:
  - [ ] Cannot delete if transactions exist
  - [ ] Can delete if no transactions

### 4. Expenses (/expenses)
- [ ] Page loads with empty or seeded data
- [ ] "Add Expense" button opens modal
- [ ] Filters button shows/hides filter panel
- [ ] Create expense:
  - [ ] Select date
  - [ ] Enter amount
  - [ ] Select category (shows only EXPENSE or BOTH types)
  - [ ] Select account
  - [ ] Enter merchant (optional)
  - [ ] Add notes (optional)
  - [ ] Add tags (comma-separated, optional)
  - [ ] Submit successfully
- [ ] Expense appears in table with:
  - [ ] Formatted date
  - [ ] Category with icon
  - [ ] Merchant name
  - [ ] Account name
  - [ ] Amount in red
- [ ] Filter expenses:
  - [ ] By date range (start and end date)
  - [ ] By category
  - [ ] By search term (merchant/notes)
  - [ ] Total updates correctly
- [ ] Clear filters works
- [ ] Edit expense:
  - [ ] Form pre-fills
  - [ ] Changes save
- [ ] Delete expense works

### 5. Income (/income)
- [ ] Page loads successfully
- [ ] "Add Income" button opens modal
- [ ] Create income:
  - [ ] Select date
  - [ ] Enter amount
  - [ ] Select category (shows only INCOME or BOTH types)
  - [ ] Select account
  - [ ] Enter source (optional)
  - [ ] Add notes and tags
  - [ ] Submit successfully
- [ ] Income appears in table with green amounts
- [ ] Filters work:
  - [ ] Date range
  - [ ] Category
  - [ ] Search
- [ ] Total Income displays correctly
- [ ] Edit and delete work

### 6. Debts (/debts)
- [ ] Page loads successfully
- [ ] Total Debt card displays sum
- [ ] "Add Debt" button opens modal
- [ ] Create debt:
  - [ ] Enter name
  - [ ] Select type
  - [ ] Enter current balance
  - [ ] Add APR (optional)
  - [ ] Add min payment (optional)
  - [ ] Add due day (optional)
  - [ ] Submit successfully
- [ ] Debt cards display:
  - [ ] Name and type
  - [ ] Current balance
  - [ ] APR, min payment, due day (if provided)
  - [ ] Recent payments (if any)
- [ ] Record payment:
  - [ ] Click "Record Payment"
  - [ ] Select date
  - [ ] Enter amount
  - [ ] Select account
  - [ ] Add notes (optional)
  - [ ] Submit
  - [ ] Debt balance decreases correctly
  - [ ] Payment appears in history
- [ ] Edit debt works
- [ ] Delete debt works

### 7. Goals (/goals)
- [ ] Page loads successfully
- [ ] "Add Goal" button opens modal
- [ ] Create goal:
  - [ ] Enter name
  - [ ] Enter target amount
  - [ ] Add due date (optional)
  - [ ] Submit successfully
- [ ] Goal cards display:
  - [ ] Name and target amount
  - [ ] Due date (if provided)
  - [ ] Progress bar (0% initially)
  - [ ] Saved amount ($0.00 initially)
  - [ ] Remaining amount
- [ ] Add contribution:
  - [ ] Click "Add Contribution"
  - [ ] Select date
  - [ ] Enter amount
  - [ ] Select account
  - [ ] Add notes (optional)
  - [ ] Submit
  - [ ] Progress bar updates
  - [ ] Saved amount increases
  - [ ] Remaining amount decreases
- [ ] Progress bar:
  - [ ] Shows correct percentage
  - [ ] Maxes at 100%
  - [ ] Color changes appropriately
- [ ] Edit goal works
- [ ] Delete goal works

### 8. Investments (/investments)
- [ ] Page loads with placeholder message
- [ ] Displays information about coming soon features

### 9. Budgets (/budgets)
- [ ] Page loads with placeholder message
- [ ] Displays information about coming soon features

### 10. Navigation
- [ ] Sidebar is fixed on left
- [ ] All menu items are clickable
- [ ] Active page is highlighted
- [ ] Icons display correctly
- [ ] Navigation works on mobile (responsive)
- [ ] Page transitions are smooth

## 🎨 UI/UX Testing

### Responsive Design
- [ ] Desktop view (1920x1080)
- [ ] Laptop view (1366x768)
- [ ] Tablet view (768x1024)
- [ ] Mobile view (375x667)

### Interactions
- [ ] Buttons have hover effects
- [ ] Modal appears with smooth animation
- [ ] Modal closes on:
  - [ ] Close button (X)
  - [ ] Cancel button
  - [ ] Escape key
  - [ ] Clicking backdrop
- [ ] Forms show validation errors
- [ ] Loading states show when submitting
- [ ] Success/error messages display

### Colors and Typography
- [ ] Colors are consistent
- [ ] Text is readable
- [ ] Icons are appropriate size
- [ ] Currency formatting is consistent
- [ ] Dates are formatted consistently

## 🔍 Data Validation Testing

### Form Validation
- [ ] Required fields show errors when empty
- [ ] Number fields reject non-numeric input
- [ ] Date fields validate proper dates
- [ ] Negative amounts are handled properly
- [ ] Very large numbers work correctly

### Database Operations
- [ ] Creating records succeeds
- [ ] Updating records preserves data
- [ ] Deleting records removes completely
- [ ] Related data is handled (cascade/restrict)
- [ ] No orphaned records

## 📊 Chart Testing

### Pie Chart (Expenses by Category)
- [ ] Displays when data exists
- [ ] Shows "no data" message when empty
- [ ] Colors match category colors
- [ ] Tooltips show on hover
- [ ] Labels are readable
- [ ] Percentages are correct

### Bar Chart (Income vs Expenses)
- [ ] Shows 12 months of data
- [ ] Green bars for income
- [ ] Red bars for expenses
- [ ] X-axis shows month abbreviations
- [ ] Y-axis shows amounts
- [ ] Tooltips show formatted currency
- [ ] Legend displays correctly

## ⚡ Performance Testing

- [ ] Initial page load < 3 seconds
- [ ] Navigation between pages is instant
- [ ] Forms submit quickly
- [ ] Charts render smoothly
- [ ] No console errors
- [ ] No memory leaks (check DevTools)

## 🐛 Bug Testing

### Common Issues to Check
- [ ] Database connection errors handled
- [ ] Network errors show user-friendly messages
- [ ] Empty states display correctly
- [ ] Null/undefined values handled
- [ ] Browser back button works
- [ ] Page refresh preserves data

### Edge Cases
- [ ] Creating transaction with $0.00
- [ ] Very long category/account names
- [ ] Special characters in text fields
- [ ] Dates in past/future
- [ ] Decimal amounts with many places

## 🔐 Security Testing

- [ ] `.env.local` is not committed to git
- [ ] Sensitive data is not exposed in browser
- [ ] Server actions validate input
- [ ] SQL injection prevented (Prisma handles this)
- [ ] XSS attacks prevented (React handles this)

## 📝 Manual Test Scenarios

### Scenario 1: New User Setup
1. Start with empty database
2. Add 3 categories (2 expense, 1 income)
3. Add 2 accounts (checking and savings)
4. Add 5 expenses across different categories
5. Add 2 income transactions
6. View dashboard - verify charts update

### Scenario 2: Debt Payoff
1. Create a debt ($5,000 student loan)
2. Record 3 payments ($500 each)
3. Verify balance decreases to $3,500
4. View payment history
5. Check dashboard total debt

### Scenario 3: Savings Goal
1. Create goal (Emergency Fund, $10,000)
2. Add 5 contributions of $500 each
3. Verify progress shows 25%
4. Add contribution to reach 50%
5. Check remaining amount

### Scenario 4: Monthly Review
1. Add various transactions over a month
2. Use date filters to view monthly expenses
3. Export data (when feature available)
4. Review category breakdown in chart
5. Compare to previous months

## ✅ Final Checks

Before considering testing complete:

- [ ] All features tested at least once
- [ ] No console errors or warnings
- [ ] All CRUD operations work
- [ ] Data persists across page refreshes
- [ ] Charts display correctly with data
- [ ] Forms validate properly
- [ ] UI is responsive on all screen sizes
- [ ] Navigation works smoothly
- [ ] Error messages are clear
- [ ] Success feedback is provided

## 📊 Test Results Template

```
Date: ___________
Tester: ___________
Browser: ___________
Version: ___________

Features Tested:
☑ Categories: PASS/FAIL
☑ Accounts: PASS/FAIL
☑ Expenses: PASS/FAIL
☑ Income: PASS/FAIL
☑ Debts: PASS/FAIL
☑ Goals: PASS/FAIL
☑ Dashboard: PASS/FAIL
☑ Navigation: PASS/FAIL

Issues Found:
1. _____________________
2. _____________________
3. _____________________

Overall: PASS/FAIL
```

## 🎯 Next Steps After Testing

If all tests pass:
- ✅ Ready for deployment!
- Consider adding more features
- Set up monitoring

If tests fail:
- Document bugs
- Prioritize fixes
- Retest after fixes
- Update documentation

---

Happy testing! 🧪✨
