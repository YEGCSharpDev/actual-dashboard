import React from 'react';

interface SankeyData {
  Category_Name: string;
  amount: number;
}

interface SankeyProps {
  income: SankeyData[];
  expenses: SankeyData[];
}

export const Sankey: React.FC<SankeyProps> = ({ income, expenses }) => {
  const width = 900;
  const height = 600;
  const leftPadding = 150;
  const rightPadding = 150;
  const paddingY = 40;
  const colWidth = 20;
  const colSpacing = (width - leftPadding - rightPadding - colWidth * 4) / 3;

  // Filter out zero-amount items
  const activeIncome = income.filter(x => x.amount > 0);
  const activeExpenses = expenses.filter(x => x.amount > 0);

  const totalIncome = activeIncome.reduce((acc, x) => acc + x.amount, 0);
  const totalExpenses = activeExpenses.reduce((acc, x) => acc + x.amount, 0);
  const netFlow = totalIncome - totalExpenses;

  if (activeIncome.length === 0 && activeExpenses.length === 0) {
    return <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: '2rem' }}>No data available for flow chart.</div>;
  }

  const systemFlow = Math.max(totalIncome, totalExpenses);
  const chartHeight = height - paddingY * 2;

  // Nodes definition
  interface Node {
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    amount: number;
  }

  const nodes: Node[] = [];
  const col0X = leftPadding;
  const col1X = leftPadding + colWidth + colSpacing;
  const col2X = leftPadding + (colWidth + colSpacing) * 2;
  const col3X = leftPadding + (colWidth + colSpacing) * 3;

  // 1. Column 0: Income items and Deficit
  let col0Y = paddingY;
  const col0Items = [...activeIncome];
  if (netFlow < 0) {
    col0Items.push({ Category_Name: 'Overspending (Deficit)', amount: Math.abs(netFlow) });
  }
  const col0Gap = col0Items.length > 1 ? 15 : 0;
  const totalCol0Gaps = col0Gap * (col0Items.length - 1);
  const col0Scale = systemFlow > 0 ? (chartHeight - totalCol0Gaps) / systemFlow : 0;

  const col0Nodes = col0Items.map(item => {
    const nodeH = item.amount * col0Scale;
    const nodeY = col0Y;
    col0Y += nodeH + col0Gap;
    return {
      id: `c0_${item.Category_Name}`,
      label: item.Category_Name,
      x: col0X,
      y: nodeY,
      w: colWidth,
      h: Math.max(nodeH, 2),
      color: item.Category_Name === 'Overspending (Deficit)' ? 'var(--color-warning)' : 'var(--color-success)',
      amount: item.amount
    };
  });
  nodes.push(...col0Nodes);

  // 2. Column 1: Central Hub (Monthly Cashflow)
  const col1H = systemFlow * col0Scale;
  const col1Node = {
    id: 'c1_hub',
    label: 'Monthly Cashflow',
    x: col1X,
    y: paddingY,
    w: colWidth,
    h: col1H,
    color: '#64748b',
    amount: systemFlow
  };
  nodes.push(col1Node);

  // 3. Column 2: Total Expenses and Savings (Net Income)
  let col2Y = paddingY;
  const col2Items: SankeyData[] = [];
  if (totalExpenses > 0) {
    col2Items.push({ Category_Name: 'Total Expenses', amount: totalExpenses });
  }
  if (netFlow > 0) {
    col2Items.push({ Category_Name: 'Savings (Net Income)', amount: netFlow });
  }
  const col2Gap = col2Items.length > 1 ? 25 : 0;
  const totalCol2Gaps = col2Gap * (col2Items.length - 1);
  const col2Scale = systemFlow > 0 ? (chartHeight - totalCol2Gaps) / systemFlow : 0;

  const col2Nodes = col2Items.map(item => {
    const nodeH = item.amount * col2Scale;
    const nodeY = col2Y;
    col2Y += nodeH + col2Gap;
    return {
      id: `c2_${item.Category_Name}`,
      label: item.Category_Name,
      x: col2X,
      y: nodeY,
      w: colWidth,
      h: Math.max(nodeH, 2),
      color: item.Category_Name === 'Total Expenses' ? 'var(--color-danger)' : 'var(--color-success)',
      amount: item.amount
    };
  });
  nodes.push(...col2Nodes);

  // 4. Column 3: Individual Expenses
  const col3Gap = activeExpenses.length > 1 ? 12 : 0;
  const totalCol3Gaps = col3Gap * (activeExpenses.length - 1);
  const col3Scale = totalExpenses > 0 ? (totalExpenses * col2Scale - totalCol3Gaps) / totalExpenses : 0;

  // Let's place Column 3 starting y aligned with the top of Total Expenses in Column 2
  const col2ExpensesNode = col2Nodes.find(n => n.label === 'Total Expenses');
  const startY = col2ExpensesNode ? col2ExpensesNode.y : paddingY;

  let currentCol3Y = startY;
  const col3Nodes = activeExpenses.map(item => {
    const nodeH = item.amount * col3Scale;
    const nodeY = currentCol3Y;
    currentCol3Y += nodeH + col3Gap;
    return {
      id: `c3_${item.Category_Name}`,
      label: item.Category_Name,
      x: col3X,
      y: nodeY,
      w: colWidth,
      h: Math.max(nodeH, 2),
      color: 'var(--color-danger)',
      amount: item.amount
    };
  });
  nodes.push(...col3Nodes);

  // Links definition and positioning
  interface Link {
    d: string;
    strokeWidth: number;
    color: string;
    tooltip: string;
  }

  const links: Link[] = [];

  // Track offset positions to correctly stack inputs/outputs on nodes
  const nodeOutputOffsets: Record<string, number> = {};
  const nodeInputOffsets: Record<string, number> = {};

  const addLink = (sourceId: string, targetId: string, flowAmount: number, linkColor: string) => {
    const sNode = nodes.find(n => n.id === sourceId);
    const tNode = nodes.find(n => n.id === targetId);
    if (!sNode || !tNode) return;

    // Output offset
    const sOffset = nodeOutputOffsets[sourceId] || 0;
    const sRatio = sNode.h / sNode.amount;
    const linkH = flowAmount * sRatio;
    const y1 = sNode.y + sOffset + linkH / 2;
    nodeOutputOffsets[sourceId] = sOffset + linkH;

    // Input offset
    const tOffset = nodeInputOffsets[targetId] || 0;
    const tRatio = tNode.h / tNode.amount;
    const linkHIn = flowAmount * tRatio;
    const y2 = tNode.y + tOffset + linkHIn / 2;
    nodeInputOffsets[targetId] = tOffset + linkHIn;

    const x1 = sNode.x + sNode.w;
    const x2 = tNode.x;

    // Bezier control coordinates
    const cx1 = x1 + colSpacing / 2;
    const cx2 = x2 - colSpacing / 2;

    const pathD = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;

    links.push({
      d: pathD,
      strokeWidth: Math.max(linkH, 1),
      color: linkColor,
      tooltip: `${sNode.label} → ${tNode.label}: $${flowAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    });
  };

  // Build links:
  // Col 0 -> Col 1: Income / Deficit -> Cashflow Hub
  col0Nodes.forEach(n => {
    const color = n.label === 'Overspending (Deficit)' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.25)';
    addLink(n.id, 'c1_hub', n.amount, color);
  });

  // Col 1 -> Col 2: Cashflow Hub -> Total Expenses & Savings
  const col2Expenses = col2Nodes.find(n => n.label === 'Total Expenses');
  if (col2Expenses) {
    addLink('c1_hub', col2Expenses.id, totalExpenses, 'rgba(244, 63, 94, 0.2)');
  }
  const col2Savings = col2Nodes.find(n => n.label === 'Savings (Net Income)');
  if (col2Savings) {
    addLink('c1_hub', col2Savings.id, netFlow, 'rgba(16, 185, 129, 0.25)');
  }

  // Col 2 -> Col 3: Total Expenses -> Individual Expenses
  if (col2Expenses) {
    col3Nodes.forEach(n => {
      addLink(col2Expenses.id, n.id, n.amount, 'rgba(244, 63, 94, 0.2)');
    });
  }

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg width={width} height={height} style={{ display: 'block', margin: '0 auto' }}>
        {/* Draw Links first so they sit behind nodes */}
        <g>
          {links.map((link, idx) => (
            <path
              key={idx}
              d={link.d}
              fill="none"
              stroke={link.color}
              strokeWidth={link.strokeWidth}
              style={{
                transition: 'stroke 0.2s',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.stroke = link.color.replace('0.25', '0.5').replace('0.2', '0.45');
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.stroke = link.color;
              }}
            >
              <title>{link.tooltip}</title>
            </path>
          ))}
        </g>

        {/* Draw Nodes */}
        <g>
          {nodes.map(node => (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                fill={node.color}
                rx={2}
                style={{ cursor: 'pointer' }}
              >
                <title>{`${node.label}: $${node.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</title>
              </rect>
              {/* Node Labels */}
              <text
                x={node.x + (node.x > width / 2 ? node.w + 6 : -6)}
                y={node.y + node.h / 2}
                fill="var(--color-text-primary)"
                fontSize="11px"
                fontWeight="600"
                textAnchor={node.x > width / 2 ? 'start' : 'end'}
                dominantBaseline="central"
                style={{
                  pointerEvents: 'none',
                  textShadow: '0 1px 3px rgba(0,0,0,0.8)'
                }}
              >
                {node.label}
              </text>
              {/* Values below/above labels for larger nodes */}
              {node.h > 12 && (
                <text
                  x={node.x + (node.x > width / 2 ? node.w + 6 : -6)}
                  y={node.y + node.h / 2 + 12}
                  fill="var(--color-text-secondary)"
                  fontSize="10px"
                  textAnchor={node.x > width / 2 ? 'start' : 'end'}
                  dominantBaseline="central"
                  style={{ pointerEvents: 'none' }}
                >
                  ${Math.round(node.amount).toLocaleString()}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
};
