import type { CashflowSankeyPayload, SankeyNode, SankeyLink } from '@shared/types/CashflowSankey';

export interface LayoutNode extends SankeyNode {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface LayoutLink extends SankeyLink {
  d: string;
  strokeWidth: number;
  color: string;
  tooltip: string;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  links: LayoutLink[];
  width: number;
  height: number;
}

export function computeSankeyLayout(data: CashflowSankeyPayload): LayoutResult {
  const width = 900;
  const height = 600;
  const leftPadding = 150;
  const rightPadding = 200;
  const paddingY = 40;
  const colWidth = 20;
  
  const colSpacing = (width - leftPadding - rightPadding - colWidth * 4) / 3;

  const activeIncome = data.nodes.filter(n => n.id.startsWith('c0_'));
  const activeExpenses = data.nodes.filter(n => n.id.startsWith('c3_'));

  const totalIncome = activeIncome.reduce((acc, x) => acc + x.amount, 0);
  const totalExpenses = activeExpenses.reduce((acc, x) => acc + x.amount, 0);
  // netFlow is not used in the layout directly since nodes already include Savings/Deficit

  if (activeIncome.length === 0 && activeExpenses.length === 0) {
    return { nodes: [], links: [], width, height };
  }

  const systemFlow = Math.max(totalIncome, totalExpenses);
  const chartHeight = height - paddingY * 2;

  const nodes: LayoutNode[] = [];
  const col0X = leftPadding;
  const col1X = leftPadding + colWidth + colSpacing;
  const col2X = leftPadding + (colWidth + colSpacing) * 2;
  const col3X = leftPadding + (colWidth + colSpacing) * 3;

  // --- 1. Column 0: Income items and Deficit ---
  let col0Y = paddingY;
  const col0Gap = activeIncome.length > 1 ? 15 : 0;
  const totalCol0Gaps = col0Gap * (activeIncome.length - 1);
  const col0Scale = systemFlow > 0 ? (chartHeight - totalCol0Gaps) / systemFlow : 0;

  activeIncome.forEach((item) => {
    const nodeH = item.amount * col0Scale;
    const nodeY = col0Y;
    col0Y += nodeH + col0Gap;
    nodes.push({
      ...item,
      x: col0X,
      y: nodeY,
      w: colWidth,
      h: Math.max(nodeH, 2),
      color: item.label === 'Overspending (Deficit)' ? 'var(--color-warning)' : 'var(--color-success)'
    });
  });

  // --- 2. Column 1: Central Hub ---
  const hubNode = data.nodes.find(n => n.id === 'c1_hub');
  if (hubNode) {
    const col1H = systemFlow * col0Scale;
    nodes.push({
      ...hubNode,
      x: col1X,
      y: paddingY,
      w: colWidth,
      h: col1H,
      color: '#64748b'
    });
  }

  // --- 3. Column 2: Total Expenses and Savings ---
  let col2Y = paddingY;
  const col2Items = data.nodes.filter(n => n.id.startsWith('c2_'));
  const col2Gap = col2Items.length > 1 ? 25 : 0;
  const totalCol2Gaps = col2Gap * (col2Items.length - 1);
  const col2Scale = systemFlow > 0 ? (chartHeight - totalCol2Gaps) / systemFlow : 0;

  col2Items.forEach((item) => {
    const nodeH = item.amount * col2Scale;
    const nodeY = col2Y;
    col2Y += nodeH + col2Gap;
    nodes.push({
      ...item,
      x: col2X,
      y: nodeY,
      w: colWidth,
      h: Math.max(nodeH, 2),
      color: item.label === 'Total Expenses' ? 'var(--color-danger)' : 'var(--color-success)'
    });
  });

  // --- 4. Column 3: Individual Expenses ---
  const col3Gap = activeExpenses.length > 1 ? 12 : 0;
  const totalCol3Gaps = col3Gap * (activeExpenses.length - 1);
  const col3Scale = totalExpenses > 0 ? (totalExpenses * col2Scale - totalCol3Gaps) / totalExpenses : 0;

  const col2ExpensesNode = nodes.find(n => n.label === 'Total Expenses');
  const startY = col2ExpensesNode ? col2ExpensesNode.y : paddingY;

  let currentCol3Y = startY;
  activeExpenses.forEach((item) => {
    const nodeH = item.amount * col3Scale;
    const nodeY = currentCol3Y;
    currentCol3Y += nodeH + col3Gap;
    nodes.push({
      ...item,
      x: col3X,
      y: nodeY,
      w: colWidth,
      h: Math.max(nodeH, 2),
      color: 'var(--color-danger)'
    });
  });

  // --- Links definition and positioning ---
  const links: LayoutLink[] = [];
  const nodeOutputOffsets: Record<string, number> = {};
  const nodeInputOffsets: Record<string, number> = {};

  const addLayoutLink = (sourceId: string, targetId: string, flowAmount: number, linkColor: string) => {
    const sNode = nodes.find(n => n.id === sourceId);
    const tNode = nodes.find(n => n.id === targetId);
    if (!sNode || !tNode) return;

    const sOffset = nodeOutputOffsets[sourceId] || 0;
    const sRatio = sNode.h / sNode.amount;
    const linkH = flowAmount * sRatio;
    const y1 = sNode.y + sOffset + linkH / 2;
    nodeOutputOffsets[sourceId] = sOffset + linkH;

    const tOffset = nodeInputOffsets[targetId] || 0;
    const tRatio = tNode.h / tNode.amount;
    const linkHIn = flowAmount * tRatio;
    const y2 = tNode.y + tOffset + linkHIn / 2;
    nodeInputOffsets[targetId] = tOffset + linkHIn;

    const x1 = sNode.x + sNode.w;
    const x2 = tNode.x;

    const cx1 = x1 + colSpacing / 2;
    const cx2 = x2 - colSpacing / 2;

    const pathD = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;

    links.push({
      sourceId,
      targetId,
      amount: flowAmount,
      d: pathD,
      strokeWidth: Math.max(linkH, 1),
      color: linkColor,
      tooltip: `${sNode.label} \u2192 ${tNode.label}: $${flowAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    });
  };

  data.links.forEach(l => {
    // Determine link color based on target/source logic
    let color = 'rgba(16, 185, 129, 0.25)'; // default success
    const sNode = nodes.find(n => n.id === l.sourceId);
    const tNode = nodes.find(n => n.id === l.targetId);
    if (sNode && sNode.label === 'Overspending (Deficit)') {
      color = 'rgba(245, 158, 11, 0.25)';
    } else if (tNode && (tNode.label === 'Total Expenses' || tNode.id.startsWith('c3_'))) {
      color = 'rgba(244, 63, 94, 0.2)';
    }
    
    addLayoutLink(l.sourceId, l.targetId, l.amount, color);
  });

  return {
    nodes,
    links,
    width,
    height
  };
}
