# Contributing to Tracker26

Thank you for your interest in contributing to Tracker26! This document provides guidelines and instructions for contributing to the project.

## 🤝 How to Contribute

### Ways to Contribute
- 🐛 Report bugs
- 💡 Suggest new features
- 📝 Improve documentation
- 🎨 Design improvements
- 💻 Code contributions
- 🧪 Write tests
- 🌐 Translations (future)

## 🐛 Reporting Bugs

### Before Submitting a Bug Report
1. Check the existing issues to avoid duplicates
2. Update to the latest version
3. Try to reproduce the bug

### How to Submit a Bug Report
Create an issue with:
- **Clear title**: Summarize the bug
- **Description**: Detailed explanation
- **Steps to reproduce**: Step-by-step guide
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Screenshots**: If applicable
- **Environment**:
  - OS and version
  - Browser and version
  - Node.js version
  - MongoDB version

### Example Bug Report
```markdown
**Title**: Expense form doesn't save when amount is decimal

**Description**:
When creating an expense with a decimal amount like $10.50, 
the form submits but the transaction doesn't appear in the list.

**Steps to Reproduce**:
1. Go to /expenses
2. Click "Add Expense"
3. Fill form with amount "10.50"
4. Click submit

**Expected**: Transaction saves and appears in list
**Actual**: Form closes but no transaction is saved

**Environment**:
- macOS Sonoma 14.1
- Chrome 120.0
- Node.js 20.10.0
```

## 💡 Suggesting Features

### Feature Request Guidelines
- Check existing feature requests
- Explain the use case
- Describe expected behavior
- Consider implementation complexity

### Feature Request Template
```markdown
**Feature**: Recurring transactions

**Problem**: 
Users need to manually add rent payments every month.

**Proposed Solution**:
Add a "recurring" checkbox when creating transactions.
Allow setting frequency (daily, weekly, monthly, yearly).

**Alternatives Considered**:
- Transaction templates
- Copy previous transaction

**Benefits**:
- Saves time for users
- Reduces manual data entry
- Common feature in finance apps
```

## 💻 Code Contributions

### Development Setup

1. **Fork the repository**
   ```bash
   # Fork on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/tracker26.git
   cd tracker26
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env.local
   # Add your DATABASE_URL
   ```

4. **Initialize database**
   ```bash
   npx prisma generate
   npx prisma db push
   npm run seed
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

### Creating a Branch
```bash
# Create a feature branch
git checkout -b feature/recurring-transactions

# Or a bug fix branch
git checkout -b fix/expense-decimal-bug
```

### Branch Naming Convention
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Adding tests
- `chore/description` - Maintenance tasks

### Commit Messages

Follow conventional commits:
```bash
# Feature
git commit -m "feat: add recurring transaction support"

# Bug fix
git commit -m "fix: resolve decimal amount parsing issue"

# Documentation
git commit -m "docs: update README with setup instructions"

# Refactor
git commit -m "refactor: simplify expense form validation"

# Tests
git commit -m "test: add tests for transaction CRUD operations"
```

### Code Style Guidelines

#### TypeScript/React
```typescript
// Use TypeScript types
interface ExpenseFormProps {
  expense?: Expense;
  onSuccess: () => void;
}

// Use arrow functions for components
export default function ExpenseForm({ expense, onSuccess }: ExpenseFormProps) {
  // Component logic
}

// Use const for variables that don't change
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};
```

#### Server Actions
```typescript
'use server';

import { prisma } from '@/lib/prisma';
import { z } from 'zod';

// Always validate input
const schema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
});

export async function createExpense(formData: FormData) {
  try {
    // Parse and validate
    const data = schema.parse(/* ... */);
    
    // Database operation
    await prisma.transaction.create({ data });
    
    // Revalidate
    revalidatePath('/expenses');
    
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Error message' };
  }
}
```

#### Styling
```tsx
// Use Tailwind CSS classes
<div className="bg-white rounded-lg shadow p-6">
  <h2 className="text-xl font-semibold text-gray-900 mb-4">
    Title
  </h2>
</div>

// For dynamic classes
<div className={`
  px-4 py-2 rounded-lg
  ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}
`}>
  Button
</div>
```

### Testing Your Changes

1. **Manual Testing**
   - Test your changes thoroughly
   - Try edge cases
   - Test on different screen sizes
   - Check console for errors

2. **Check Types**
   ```bash
   npx tsc --noEmit
   ```

3. **Lint Code**
   ```bash
   npm run lint
   ```

4. **Build Test**
   ```bash
   npm run build
   ```

### Submitting a Pull Request

1. **Push your branch**
   ```bash
   git push origin feature/your-feature
   ```

2. **Create Pull Request on GitHub**
   - Go to your fork on GitHub
   - Click "New Pull Request"
   - Select your branch
   - Fill out the PR template

3. **PR Template**
   ```markdown
   ## Description
   Brief description of changes
   
   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Documentation update
   - [ ] Refactoring
   
   ## Changes Made
   - Added recurring transaction support
   - Updated transaction form
   - Added database migration
   
   ## Testing
   - [ ] Tested locally
   - [ ] Checked console for errors
   - [ ] Tested on mobile
   - [ ] Build succeeds
   
   ## Screenshots (if applicable)
   [Add screenshots]
   
   ## Related Issues
   Closes #123
   ```

4. **Wait for Review**
   - Address feedback
   - Make requested changes
   - Push updates to same branch

### Code Review Process

All submissions require review:
- Code quality check
- Functionality verification
- Documentation review
- Performance consideration
- Security assessment

## 📝 Documentation

### Updating Documentation
- Keep README up to date
- Update inline code comments
- Add JSDoc comments for functions
- Update ROADMAP.md for features
- Update TESTING.md for new tests

### Documentation Style
```typescript
/**
 * Formats a number as USD currency
 * @param amount - The numeric amount to format
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
```

## 🎨 Design Contributions

### Design Guidelines
- Follow existing design patterns
- Maintain consistent spacing
- Use Tailwind CSS utilities
- Ensure responsive design
- Consider accessibility

### Color Palette
```
Primary Blue: #3b82f6
Success Green: #10b981
Danger Red: #ef4444
Warning Yellow: #f59e0b
Neutral Gray: #6b7280
```

## 🧪 Testing Guidelines

### Manual Testing Checklist
- [ ] Feature works as expected
- [ ] Edge cases handled
- [ ] Error states display properly
- [ ] Loading states show
- [ ] Responsive on mobile
- [ ] No console errors
- [ ] Data persists correctly

### Future: Automated Tests
When test infrastructure is added:
- Write unit tests for utilities
- Add integration tests for API routes
- Include E2E tests for critical flows

## 🔄 Project Structure

```
tracker26/
├── app/              # Next.js pages and routes
├── components/       # Reusable UI components
├── lib/             # Utilities and helpers
├── prisma/          # Database schema and migrations
└── public/          # Static assets
```

### Adding New Features

1. **Plan**: Review ROADMAP.md and create issue
2. **Design**: Sketch UI and data flow
3. **Schema**: Update Prisma schema if needed
4. **Backend**: Create server actions
5. **Frontend**: Build components
6. **Test**: Thorough testing
7. **Document**: Update docs
8. **Submit**: Create PR

## 🚫 What NOT to Do

- Don't commit `.env.local` or secrets
- Don't make unrelated changes in same PR
- Don't ignore linting errors
- Don't skip testing
- Don't break existing functionality
- Don't add unnecessary dependencies

## ✅ Checklist Before Submitting

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No console errors
- [ ] Tested on multiple browsers
- [ ] Tested on mobile
- [ ] Build succeeds
- [ ] Commits follow convention
- [ ] PR description is clear

## 🏆 Recognition

Contributors will be:
- Listed in README.md
- Credited in release notes
- Thanked in community updates

## 📞 Getting Help

- Open a discussion on GitHub
- Ask in issues
- Review existing documentation
- Check TESTING.md for testing guidance

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Tracker26! Your help makes this project better for everyone.** 🎉

Questions? Open an issue or discussion on GitHub!
