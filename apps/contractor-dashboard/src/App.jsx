import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import AddExpense from './components/AddExpense';
import ExpenseHistory from './components/ExpenseHistory';
import { Download, LayoutDashboard } from 'lucide-react';
import { supabase } from './supabaseClient';

function App() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('date', { ascending: false });
      
      if (error) throw error;
      if (data) setExpenses(data);
    } catch (error) {
      console.error('Error fetching expenses:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddExpense = async (newExpense) => {
    // Optimistic update
    setExpenses(prev => [newExpense, ...prev]);

    try {
      const { error } = await supabase
        .from('expenses')
        .insert([{
          id: newExpense.id,
          amount: newExpense.amount,
          category: newExpense.category,
          payee: newExpense.payee,
          date: newExpense.date
        }]);

      if (error) {
        // Revert on failure
        setExpenses(prev => prev.filter(exp => exp.id !== newExpense.id));
        throw error;
      }
    } catch (error) {
      console.error('Error adding expense:', error.message);
      alert('Failed to save expense to the cloud.');
    }
  };

  const handleDeleteExpense = async (id) => {
    // Keep a copy in case of failure
    const previousExpenses = [...expenses];
    
    // Optimistic delete
    setExpenses(prev => prev.filter(exp => exp.id !== id));

    try {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting expense:', error.message);
      alert('Failed to delete expense.');
      // Revert on failure
      setExpenses(previousExpenses);
    }
  };

  const exportToCSV = () => {
    if (expenses.length === 0) return;
    
    const headers = ['Date', 'Category', 'Payee', 'Amount (PKR)'];
    const csvContent = [
      headers.join(','),
      ...expenses.map(exp => {
        const date = new Date(exp.date).toLocaleDateString('en-PK');
        return `"${date}","${exp.category}","${exp.payee}",${exp.amount}`;
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `shakeel_expenses_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Get unique categories from current expenses for the tabs
  const categories = ['All', ...new Set(expenses.map(exp => exp.category))];
  
  // Filter expenses based on selected tab
  const filteredExpenses = selectedCategory === 'All' 
    ? expenses 
    : expenses.filter(exp => exp.category === selectedCategory);

  return (
    <>
      <div className="header-actions">
        <div>
          <h1>Shakeel Contractor Dashboard</h1>
          <p className="subtitle">
            {loading ? 'Syncing with cloud...' : 'Track and manage your expenses professionally'}
          </p>
        </div>
        
        <button onClick={exportToCSV} className="secondary-btn" style={{ width: 'auto' }}>
          <Download size={18} />
          Export CSV
        </button>
      </div>

      {/* Category Tabs */}
      {expenses.length > 0 && (
        <div className="category-tabs" style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={selectedCategory === cat ? 'tab-active' : 'tab-inactive'}
              style={{
                width: 'auto',
                padding: '0.5rem 1.25rem',
                borderRadius: '999px',
                fontWeight: '500',
                fontSize: '0.9rem',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
                backgroundColor: selectedCategory === cat ? 'var(--accent)' : '#ffffff',
                color: selectedCategory === cat ? '#ffffff' : 'var(--text-muted)',
                border: selectedCategory === cat ? 'none' : '1px solid #e2e8f0',
                boxShadow: selectedCategory === cat ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
              }}
            >
              {cat === 'All' && <LayoutDashboard size={14} style={{ marginRight: '0.35rem', display: 'inline' }} />}
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="app-container">
        <main className="main-content">
          <Dashboard expenses={filteredExpenses} selectedCategory={selectedCategory} />
          <ExpenseHistory expenses={filteredExpenses} onDelete={handleDeleteExpense} />
        </main>
        
        <aside className="sidebar">
          <AddExpense onAddExpense={handleAddExpense} />
        </aside>
      </div>
    </>
  );
}

export default App;
