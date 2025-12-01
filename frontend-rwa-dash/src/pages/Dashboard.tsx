/**
 * @fileoverview Main Dashboard for RWA Tokenization Platform
 * @description Unified interface for issuers, regulators, and investors
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  LinearProgress,
  Alert
} from '@mui/material';
import {
  AccountBalance,
  Gavel,
  Security,
  TrendingUp,
  VerifiedUser,
  Description
} from '@mui/icons-material';

interface AssetSummary {
  assetId: string;
  name: string;
  type: string;
  valuation: number;
  tokenSupply: number;
  verificationStatus: 'Verified' | 'Pending' | 'Rejected';
  complianceStatus: 'Compliant' | 'Review' | 'Non-Compliant';
}

interface InvestorProfile {
  address: string;
  name: string;
  investorType: 'Accredited' | 'Qualified' | 'Institutional';
  jurisdiction: string;
  kycStatus: 'Verified' | 'Pending' | 'Expired';
  totalInvestment: number;
}

const Dashboard: React.FC = () => {
  const [userRole, setUserRole] = useState<'issuer' | 'investor' | 'regulator'>('issuer');
  const [activeTab, setActiveTab] = useState(0);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch user data and assets
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // Simulated API call
      const mockAssets: AssetSummary[] = [
        {
          assetId: '0x1a2b3c...',
          name: 'Manhattan Commercial Property',
          type: 'Real Estate',
          valuation: 25000000,
          tokenSupply: 100000,
          verificationStatus: 'Verified',
          complianceStatus: 'Compliant'
        },
        {
          assetId: '0x4d5e6f...',
          name: 'Corporate Bond Series A',
          type: 'Corporate Bond',
          valuation: 10000000,
          tokenSupply: 50000,
          verificationStatus: 'Verified',
          complianceStatus: 'Compliant'
        },
        {
          assetId: '0x7g8h9i...',
          name: 'Private Equity Fund III',
          type: 'Private Equity',
          valuation: 50000000,
          tokenSupply: 200000,
          verificationStatus: 'Pending',
          complianceStatus: 'Review'
        }
      ];

      setAssets(mockAssets);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Verified':
      case 'Compliant':
        return 'success';
      case 'Pending':
      case 'Review':
        return 'warning';
      case 'Rejected':
      case 'Non-Compliant':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" gutterBottom fontWeight="bold">
          RWA Tokenization Platform
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          Real-World Asset Digital Securities Management
        </Typography>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <AccountBalance sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
                <Typography variant="h6">Total Assets</Typography>
              </Box>
              <Typography variant="h4" fontWeight="bold">
                {assets.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatCurrency(assets.reduce((sum, a) => sum + a.valuation, 0))} Total Value
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <VerifiedUser sx={{ fontSize: 40, color: 'success.main', mr: 2 }} />
                <Typography variant="h6">Verified Assets</Typography>
              </Box>
              <Typography variant="h4" fontWeight="bold">
                {assets.filter(a => a.verificationStatus === 'Verified').length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {((assets.filter(a => a.verificationStatus === 'Verified').length / assets.length) * 100).toFixed(0)}% Verification Rate
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Security sx={{ fontSize: 40, color: 'info.main', mr: 2 }} />
                <Typography variant="h6">Compliance</Typography>
              </Box>
              <Typography variant="h4" fontWeight="bold">
                {assets.filter(a => a.complianceStatus === 'Compliant').length}/{assets.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                SEC Reg D & EU MiCA
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card elevation={3}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TrendingUp sx={{ fontSize: 40, color: 'warning.main', mr: 2 }} />
                <Typography variant="h6">Token Supply</Typography>
              </Box>
              <Typography variant="h4" fontWeight="bold">
                {(assets.reduce((sum, a) => sum + a.tokenSupply, 0) / 1000).toFixed(0)}K
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Tokens Issued
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Card elevation={3}>
        <Tabs value={activeTab} onChange={handleTabChange} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Assets" />
          <Tab label="Tokenize New Asset" />
          <Tab label="Compliance" />
          <Tab label="Investors" />
          <Tab label="Reports" />
        </Tabs>

        {/* Assets Tab */}
        {activeTab === 0 && (
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Asset Portfolio
            </Typography>

            {loading ? (
              <LinearProgress />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Asset Name</strong></TableCell>
                    <TableCell><strong>Type</strong></TableCell>
                    <TableCell><strong>Valuation</strong></TableCell>
                    <TableCell><strong>Token Supply</strong></TableCell>
                    <TableCell><strong>Verification</strong></TableCell>
                    <TableCell><strong>Compliance</strong></TableCell>
                    <TableCell><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {assets.map((asset) => (
                    <TableRow key={asset.assetId} hover>
                      <TableCell>{asset.name}</TableCell>
                      <TableCell>{asset.type}</TableCell>
                      <TableCell>{formatCurrency(asset.valuation)}</TableCell>
                      <TableCell>{asset.tokenSupply.toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          label={asset.verificationStatus}
                          color={getStatusColor(asset.verificationStatus) as any}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={asset.complianceStatus}
                          color={getStatusColor(asset.complianceStatus) as any}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="outlined" size="small">
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        )}

        {/* Tokenize New Asset Tab */}
        {activeTab === 1 && (
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Tokenize New Asset
            </Typography>
            <Alert severity="info" sx={{ mb: 3 }}>
              Follow the step-by-step process to tokenize a new real-world asset with full legal compliance.
            </Alert>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Description sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
                      <Typography variant="h6">Step 1: Asset Documentation</Typography>
                    </Box>
                    <Typography variant="body2" paragraph>
                      Upload legal documents, appraisals, and ownership proofs. Documents are stored on IPFS and Arweave for permanent, tamper-proof storage.
                    </Typography>
                    <Button variant="contained" fullWidth>
                      Upload Documents
                    </Button>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Gavel sx={{ fontSize: 40, color: 'secondary.main', mr: 2 }} />
                      <Typography variant="h6">Step 2: Legal Structure</Typography>
                    </Box>
                    <Typography variant="body2" paragraph>
                      Create SPV/LLC legal entity wrapper. Choose jurisdiction and configure operating agreement terms.
                    </Typography>
                    <Button variant="contained" fullWidth>
                      Create Legal Entity
                    </Button>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Security sx={{ fontSize: 40, color: 'success.main', mr: 2 }} />
                      <Typography variant="h6">Step 3: Compliance Setup</Typography>
                    </Box>
                    <Typography variant="body2" paragraph>
                      Configure regulatory compliance (SEC Reg D/S, EU MiCA). Set investor restrictions and KYC requirements.
                    </Typography>
                    <Button variant="contained" fullWidth>
                      Configure Compliance
                    </Button>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <AccountBalance sx={{ fontSize: 40, color: 'warning.main', mr: 2 }} />
                      <Typography variant="h6">Step 4: Token Issuance</Typography>
                    </Box>
                    <Typography variant="body2" paragraph>
                      Deploy ERC-1400 security token contract. Define token parameters, partitions, and issuance schedule.
                    </Typography>
                    <Button variant="contained" fullWidth>
                      Issue Tokens
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </CardContent>
        )}

        {/* Compliance Tab */}
        {activeTab === 2 && (
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Compliance Dashboard
            </Typography>
            <Alert severity="success" sx={{ mb: 3 }}>
              All assets are currently compliant with SEC Reg D and EU MiCA regulations.
            </Alert>

            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      SEC Compliance
                    </Typography>
                    <Typography variant="body2" paragraph>
                      • Regulation D (Rule 506c)<br />
                      • Form D Filed: Yes<br />
                      • Accredited Investors Only<br />
                      • Blue Sky Exemptions: Active
                    </Typography>
                    <Button variant="outlined" size="small">
                      View SEC Filings
                    </Button>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      EU MiCA Compliance
                    </Typography>
                    <Typography variant="body2" paragraph>
                      • Whitepaper Published<br />
                      • ESMA Registered<br />
                      • AML Directive Compliant<br />
                      • GDPR Compliant
                    </Typography>
                    <Button variant="outlined" size="small">
                      View EU Docs
                    </Button>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={4}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      KYC/AML Status
                    </Typography>
                    <Typography variant="body2" paragraph>
                      • Active Investors: 234<br />
                      • Pending KYC: 12<br />
                      • Sanctions Screening: Pass<br />
                      • Last Audit: 2 weeks ago
                    </Typography>
                    <Button variant="outlined" size="small">
                      Run AML Check
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </CardContent>
        )}

        {/* Investors Tab */}
        {activeTab === 3 && (
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Investor Registry
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Complete list of verified investors across all tokenized assets.
            </Typography>

            <Table>
              <TableHead>
                <TableRow>
                  <TableCell><strong>Investor Name</strong></TableCell>
                  <TableCell><strong>Type</strong></TableCell>
                  <TableCell><strong>Jurisdiction</strong></TableCell>
                  <TableCell><strong>KYC Status</strong></TableCell>
                  <TableCell><strong>Total Investment</strong></TableCell>
                  <TableCell><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow hover>
                  <TableCell>John Doe</TableCell>
                  <TableCell>Accredited</TableCell>
                  <TableCell>US-NY</TableCell>
                  <TableCell>
                    <Chip label="Verified" color="success" size="small" />
                  </TableCell>
                  <TableCell>$250,000</TableCell>
                  <TableCell>
                    <Button variant="outlined" size="small">
                      View Profile
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        )}

        {/* Reports Tab */}
        {activeTab === 4 && (
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Reports & Analytics
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Button variant="outlined" fullWidth sx={{ p: 2, justifyContent: 'flex-start' }}>
                  <Description sx={{ mr: 2 }} />
                  Generate Cap Table Report
                </Button>
              </Grid>

              <Grid item xs={12} md={6}>
                <Button variant="outlined" fullWidth sx={{ p: 2, justifyContent: 'flex-start' }}>
                  <Description sx={{ mr: 2 }} />
                  Generate K-1 Tax Forms
                </Button>
              </Grid>

              <Grid item xs={12} md={6}>
                <Button variant="outlined" fullWidth sx={{ p: 2, justifyContent: 'flex-start' }}>
                  <Description sx={{ mr: 2 }} />
                  Generate SEC Form D
                </Button>
              </Grid>

              <Grid item xs={12} md={6}>
                <Button variant="outlined" fullWidth sx={{ p: 2, justifyContent: 'flex-start' }}>
                  <Description sx={{ mr: 2 }} />
                  Export Audit Trail
                </Button>
              </Grid>
            </Grid>
          </CardContent>
        )}
      </Card>
    </Box>
  );
};

export default Dashboard;
