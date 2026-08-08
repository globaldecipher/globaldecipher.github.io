import React, { useState } from 'react';
import { PlusCircle } from 'lucide-react';

const DEFAULT_CATEGORIES = [
  'Plumber',
  'Electrician',
  'Tiles/Masonry',
  'Labor',
  'Materials',
  'Painter',
  'Other'
];

const AddExpense = ({ onAddExpense }) => {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [payee, setPayee] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!amount || !payee) return;

    const finalCategory = category === 'Other' && customCategory ? customCategory : category;

    onAddExpense({
      id: crypto.randomUUID(),
      amount: parseFloat(amount),
      category: finalCategory,
      payee: payee,
      date: new Date().toISOString(),
    });

    // Reset form
    setAmount('');
    setPayee('');
    setCategory(DEFAULT_CATEGORIES[0]);
    setCustomCategory('');
  };

  return (
    <div className="card">
      <h2>Add New Expense</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Amount (PKR)</label>
          <input 
            type="number" 
            value={amount} 
            onChange={(e) => setAmount(e.target.value)} 
            placeholder="e.g. 2000"
            required
            min="1"
          />
        </div>

        <div className="form-group">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {DEFAULT_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {category === 'Other' && (
          <div className="form-group">
            <label>Custom Category</label>
            <input 
              type="text" 
              value={customCategory} 
              onChange={(e) => setCustomCategory(e.target.value)} 
              placeholder="e.g. Carpenter"
              required
            />
          </div>
        )}

        <div className="form-group">
          <label>Payee / Sub-category</label>
          <input 
            type="text" 
            value={payee} 
            onChange={(e) => setPayee(e.target.value)} 
            placeholder="e.g. Amir"
            required
          />
        </div>

        <button type="submit" style={{ marginTop: '0.5rem' }}>
          <PlusCircle size={20} />
          Add Expense
        </button>
      </form>
    </div>
  );
};

export default AddExpense;
