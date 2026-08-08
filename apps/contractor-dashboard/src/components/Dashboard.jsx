import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];

const Dashboard = ({ expenses, selectedCategory = 'All' }) => {
  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  const expensesByCategory = expenses.reduce((acc, exp) => {
    acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
    return acc;
  }, {});

  const chartData = Object.entries(expensesByCategory).map(([name, value]) => ({
    name,
    value
  })).sort((a, b) => b.value - a.value);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="card dashboard">
      <h2>{selectedCategory === 'All' ? 'Dashboard Overview' : `${selectedCategory} Overview`}</h2>
      
      <div className="stats-grid">
        <div className="stat-card primary">
          <span className="stat-title">
            {selectedCategory === 'All' ? 'Total Expenses' : `Total ${selectedCategory} Expenses`}
          </span>
          <span className="stat-value">{formatCurrency(totalExpenses)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-title">Transactions</span>
          <span className="stat-value">{expenses.length}</span>
        </div>
      </div>

      {chartData.length > 1 && selectedCategory === 'All' && (
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                formatter={(value) => formatCurrency(value)}
                contentStyle={{ borderRadius: '0.5rem', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
              />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
