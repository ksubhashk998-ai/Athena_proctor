import React from 'react';
import { Chip } from '@mui/material';
import { ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react';

export const RiskChip = ({ level }) => {
  const normalized = (level || 'Low').toUpperCase();

  if (normalized === 'HIGH' || normalized === 'CRITICAL') {
    return (
      <Chip
        icon={<ShieldAlert size={14} color="#ef4444" />}
        label="High Risk"
        size="small"
        sx={{
          fontWeight: 800,
          fontSize: '0.725rem',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          color: '#ef4444',
          border: '1px solid rgba(239, 68, 68, 0.3)'
        }}
      />
    );
  }

  if (normalized === 'MEDIUM') {
    return (
      <Chip
        icon={<AlertTriangle size={14} color="#f59e0b" />}
        label="Medium Risk"
        size="small"
        sx={{
          fontWeight: 800,
          fontSize: '0.725rem',
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          color: '#f59e0b',
          border: '1px solid rgba(245, 158, 11, 0.3)'
        }}
      />
    );
  }

  return (
    <Chip
      icon={<ShieldCheck size={14} color="#10b981" />}
      label="Low Risk"
      size="small"
      sx={{
        fontWeight: 800,
        fontSize: '0.725rem',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        color: '#10b981',
        border: '1px solid rgba(16, 185, 129, 0.3)'
      }}
    />
  );
};

export default RiskChip;
