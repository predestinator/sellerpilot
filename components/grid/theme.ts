import { themeQuartz } from 'ag-grid-community';

/** SellerPilot grid theme built with the AG Grid Theming API (tokens mirror globals.css). */
export const sellerPilotTheme = themeQuartz.withParams({
  fontFamily: 'var(--font)',
  fontSize: 13,
  accentColor: '#1f5eff',
  foregroundColor: '#0f1b2d',
  borderColor: '#e3e8f1',
  headerBackgroundColor: '#f7f9fd',
  headerTextColor: '#5b6b82',
  headerFontWeight: 600,
  rowHoverColor: '#f2f6ff',
  selectedRowBackgroundColor: '#e8efff',
  oddRowBackgroundColor: '#fcfdff',
  wrapperBorderRadius: 10,
  rowHeight: 48,
  headerHeight: 40,
  spacing: 7,
  cellHorizontalPadding: 14,
});
