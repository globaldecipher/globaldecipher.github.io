import React from 'react';
import { Trash2 } from 'lucide-react';

const ExpenseHistory = ({ expenses, onDelete }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-PK', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Sort expenses by date descending (newest first)
  const sortedExpenses = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="card">
      <h2>Recent Expenses</h2>
      
      {sortedExpenses.length === 0 ? (
        <div className="empty-state">
          <p>No expenses recorded yet. Add your first expense!</p>
        </div>
      ) : (
        <div className="history-list">
          {sortedExpenses.map((exp) => (
            <div key={exp.id} className="history-item">
              <div className="history-info">
                <span className="history-title">{exp.payee}</span>
                <div className="history-meta">
                  <span className="category-badge">{exp.category}</span>
                  <span>{formatDate(exp.date)}</span>
                </div>
              </div>
              <div className="history-right">
                <span className="history-amount">{formatCurrency(exp.amount)}</span>
                <button 
                  onClick={() => onDelete(exp.id)}
                  className="icon-btn"
                  title="Delete Expense"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExpenseHistory;
