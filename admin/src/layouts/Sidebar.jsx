import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  Chip,
  useTheme
} from '@mui/material';
import {
  LayoutDashboard,
  Users,
  BarChart3,
  FileSpreadsheet,
  ShieldCheck,
  Radio
} from 'lucide-react';

const DRAWER_WIDTH = 260;

const menuItems = [
  { text: 'Dashboard', path: '/', icon: <LayoutDashboard size={20} /> },
  { text: 'Live Monitoring', path: '/live', icon: <Users size={20} />, badge: 'LIVE' },
  { text: 'Analytics', path: '/analytics', icon: <BarChart3 size={20} /> },
  { text: 'Reports', path: '/reports', icon: <FileSpreadsheet size={20} /> }
];

export const Sidebar = ({ mobileOpen, handleDrawerToggle }) => {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const drawerContent = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.palette.background.paper,
        borderRight: `1px solid ${theme.palette.divider}`
      }}
    >
      {/* Brand Header */}
      <Box
        sx={{
          p: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          cursor: 'pointer'
        }}
        onClick={() => navigate('/')}
      >
        <Box
          sx={{
            width: 42,
            height: 42,
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 8px 16px -4px rgba(99, 102, 241, 0.5)'
          }}
        >
          <ShieldCheck size={26} />
        </Box>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
            ATHENA
          </Typography>
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontWeight: 600 }}>
            Proctoring Admin
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ mx: 2, opacity: 0.5 }} />

      {/* Navigation List */}
      <List sx={{ px: 2, py: 3, flexGrow: 1 }}>
        <Typography
          variant="caption"
          sx={{
            px: 2,
            mb: 1.5,
            display: 'block',
            fontWeight: 700,
            color: theme.palette.text.secondary,
            letterSpacing: '0.08em',
            textTransform: 'uppercase'
          }}
        >
          Main Menu
        </Typography>

        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;

          return (
            <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                onClick={() => {
                  navigate(item.path);
                  if (mobileOpen) handleDrawerToggle();
                }}
                sx={{
                  borderRadius: '12px',
                  py: 1.2,
                  px: 2,
                  backgroundColor: isActive
                    ? theme.palette.mode === 'dark'
                      ? 'rgba(99, 102, 241, 0.15)'
                      : 'rgba(79, 70, 229, 0.08)'
                    : 'transparent',
                  color: isActive ? theme.palette.primary.main : theme.palette.text.primary,
                  fontWeight: isActive ? 700 : 500,
                  '&:hover': {
                    backgroundColor: theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.05)'
                      : 'rgba(0, 0, 0, 0.03)'
                  }
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 36,
                    color: isActive ? theme.palette.primary.main : theme.palette.text.secondary
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontSize: '0.925rem',
                    fontWeight: isActive ? 700 : 500
                  }}
                />
                {item.badge && (
                  <Chip
                    icon={<Radio size={12} color="#ef4444" className="animate-pulse" />}
                    label={item.badge}
                    size="small"
                    color="error"
                    variant="soft"
                    sx={{
                      height: 22,
                      fontSize: '0.675rem',
                      fontWeight: 800,
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      color: '#ef4444'
                    }}
                  />
                )}
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      {/* Footer System Info */}
      <Box sx={{ p: 2.5, m: 2, borderRadius: 3, backgroundColor: theme.palette.surface.main }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: theme.palette.text.primary }}>
            AI Engine Connected
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: theme.palette.text.secondary, display: 'block', fontSize: '0.72rem' }}>
          FastAPI & TensorFlow Active
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
      {/* Mobile Drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH }
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop Permanent Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH, borderRight: 'none' }
        }}
        open
      >
        {drawerContent}
      </Drawer>
    </Box>
  );
};

export default Sidebar;
