import React, { useEffect, useState, useCallback } from 'react';
import { Box, Typography, TextField, MenuItem, InputAdornment, Paper } from '@mui/material';
import { Search } from 'lucide-react';
import { adminApi } from '../services/api';
import ReportsTable from '../components/reports/ReportsTable';
import ExportActions from '../components/reports/ExportActions';

export const ReportsPage = () => {
  const [reports, setReports] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (searchTerm) params.search = searchTerm;
      if (riskFilter) params.riskLevel = riskFilter;

      const response = await adminApi.getReports(params);
      if (response.data && response.data.success) {
        setReports(response.data.reports || []);
      }
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, riskFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return (
    <Box>
      {/* Header & Export Actions */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            Exam Audit Reports
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Comprehensive audit trails, violation logs, and exportable proctor reports
          </Typography>
        </Box>

        {/* PDF & Excel Export Actions */}
        <ExportActions reports={reports} />
      </Box>

      {/* Filters Bar */}
      <Paper sx={{ p: 2.5, borderRadius: 4, mb: 3 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <TextField
            placeholder="Search by student name, USN, email, or report ID..."
            size="small"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ flexGrow: 1, minWidth: 280 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={18} />
                </InputAdornment>
              )
            }}
          />

          <TextField
            select
            size="small"
            label="Filter by Risk"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All Risk Levels</MenuItem>
            <MenuItem value="High">High Risk</MenuItem>
            <MenuItem value="Medium">Medium Risk</MenuItem>
            <MenuItem value="Low">Low Risk</MenuItem>
          </TextField>
        </Box>
      </Paper>

      {/* Main Reports Table */}
      <ReportsTable reports={reports} loading={loading} />
    </Box>
  );
};

export default ReportsPage;
