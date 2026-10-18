/**
 * Ant Design theme tokens tuned to look like Cherry Studio:
 * rounded controls, a red-cherry primary, compact spacing, light/dark variants.
 */
export const BRAND = '#f5222d'

export const lightTokens = {
  colorPrimary: BRAND,
  colorInfo: BRAND,
  colorLink: BRAND,
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  fontSize: 14,
  wireframe: false,
  colorBgLayout: '#f7f7f7',
  controlHeight: 32
}

export const darkTokens = {
  colorPrimary: '#ff5f56',
  colorInfo: '#ff5f56',
  colorLink: '#ff7875',
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  fontSize: 14,
  wireframe: false,
  controlHeight: 32
}

export const components = {
  Button: { controlHeight: 32, paddingInline: 14 },
  Input: { controlHeight: 32 },
  Select: { controlHeight: 32 },
  List: { itemPadding: '8px 12px' },
  Menu: { itemHeight: 38, itemMarginInline: 8, itemBorderRadius: 8 },
  Tabs: { horizontalItemPadding: '8px 14px' },
  Card: { paddingLG: 16 }
}

/** CSS variables the hand-written layout styles rely on. */
export const cssVars = (dark) => ({
  '--navbar-bg': dark ? '#1f1f1f' : '#ffffff',
  '--navbar-border': dark ? '#303030' : '#e8e8e8',
  '--panel-bg': dark ? '#141414' : '#ffffff',
  '--panel-soft': dark ? '#1c1c1c' : '#fafafa',
  '--panel-border': dark ? '#2a2a2a' : '#f0f0f0',
  '--text-1': dark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)',
  '--text-2': dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
  '--text-3': dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
  '--bubble-user': dark ? '#2a2122' : '#fff1f0',
  '--hover-bg': dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  '--active-bg': dark ? 'rgba(255,95,86,0.16)' : 'rgba(245,34,45,0.08)'
})
