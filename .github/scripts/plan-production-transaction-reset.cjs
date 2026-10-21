// Read-only production reset preview. No SQL or ORM writes are permitted.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const requireBackend = createRequire(path.resolve('backend/package.json'));
const { PrismaClient } = requireBackend('@prisma/client');

async function readSnapshot(tx) {
      const tables = ['profiles','products','product_variants','product_skus','inventory_batches','inventory_movements','reservations','reservation_items','reservation_schedule_changes','reservation_idempotency_keys','reservation_bulk_actions','receipts','walk_in_sales','walk_in_sale_items','walk_in_sale_cost_allocations','payments','online_payments','online_payment_attempts','paymongo_webhook_events','order_item_cost_allocations','treasury_official_receipts'];
      const counts = {};
      for (const table of tables) counts[table] = Number((await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`))[0].count);
      const products = await tx.product.findMany({ select: { id:true,name:true,stock:true,skuInventoryEnabled:true }, orderBy:{id:'asc'} });
      const skus = await tx.productSku.findMany({ select:{id:true,productId:true,stock:true,isActive:true,optionValues:{select:{variantId:true}}},orderBy:{id:'asc'} });
      const variants = await tx.productVariant.findMany({select:{id:true,productId:true,optionName:true,optionValue:true,stock:true},orderBy:{id:'asc'}});
      const movements = await tx.inventoryMovement.findMany({select:{id:true,productId:true,skuId:true,variantId:true,type:true,previousStock:true,newStock:true,notes:true,createdAt:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
      const batches = await tx.inventoryBatch.findMany({select:{id:true,productId:true,skuId:true,quantityReceived:true,quantityRemaining:true,costVerified:true},orderBy:{id:'asc'}});
      const allocations = [
        ...await tx.walkInSaleCostAllocation.findMany({where:{reversedAt:null},select:{id:true,inventoryBatchId:true,quantity:true},orderBy:{id:'asc'}}),
        ...await tx.orderItemCostAllocation.findMany({where:{reversedAt:null},select:{id:true,inventoryBatchId:true,quantity:true},orderBy:{id:'asc'}})
      ];
      const sales = await tx.walkInSale.findMany({select:{id:true,receiptId:true,voidedAt:true},orderBy:{id:'asc'}});
      const reservations = await tx.reservation.findMany({select:{id:true,status:true,receipt:{select:{status:true}}},orderBy:{id:'asc'}});
      const onlinePayments = await tx.onlinePayment.groupBy({by:['status'],_count:{_all:true}});
      return {counts,products,skus,variants,movements,batches,allocations,sales,reservations,onlinePayments};
}
function buildPlan(data,expected) {
    const transactionTypes = new Set(['SALE','RESERVATION_HOLD','RESERVATION_CANCEL','RESERVATION_NO_SHOW']);
    const isTransaction = m => transactionTypes.has(m.type) || (m.type==='ADJUSTMENT' && /^(Walk-in sale .+ voided|Receipt .+ voided)/i.test(m.notes??''));
    const transactionMovements = data.movements.filter(isTransaction);
    const group = rows => { const values=new Map(); for(const r of rows) values.set(r.id,(values.get(r.id)??0)+r.quantity); return values; };
    const productDeltas = group(transactionMovements.filter(m=>!m.skuId&&!m.variantId).map(m=>({id:m.productId,quantity:m.previousStock-m.newStock})));
    const skuDeltas = group(transactionMovements.filter(m=>m.skuId&&!m.variantId).map(m=>({id:m.skuId,quantity:m.previousStock-m.newStock})));
    const variantDeltas = group(transactionMovements.filter(m=>m.variantId&&!m.skuId).map(m=>({id:m.variantId,quantity:m.previousStock-m.newStock})));
    for(const sku of data.skus) for(const link of sku.optionValues) variantDeltas.set(link.variantId,(variantDeltas.get(link.variantId)??0)+(skuDeltas.get(sku.id)??0));
    const batchDeltas = group(data.allocations.map(a=>({id:a.inventoryBatchId,quantity:a.quantity})));
    const changes = (rows,deltas) => rows.filter(r=>deltas.get(r.id)).map(r=>({id:r.id,...(r.productId?{productId:r.productId}:{}),...(r.name?{name:r.name}:{}),...(r.optionValue?{option:r.optionName+': '+r.optionValue}:{}),before:r.stock,restore:deltas.get(r.id),after:r.stock+deltas.get(r.id)}));
    const productChanges=changes(data.products,productDeltas), skuChanges=changes(data.skus,skuDeltas), variantChanges=changes(data.variants,variantDeltas);
    const batchChanges=data.batches.filter(b=>batchDeltas.get(b.id)).map(b=>({id:b.id,productId:b.productId,skuId:b.skuId,before:b.quantityRemaining,restore:batchDeltas.get(b.id),after:b.quantityRemaining+batchDeltas.get(b.id),received:b.quantityReceived}));
    const warnings=[];
    for(const p of productChanges){
      const first=transactionMovements.find(m=>m.productId===p.id&&m.previousStock!==m.newStock)?.createdAt;
      const laterCounts=data.movements.filter(m=>m.productId===p.id&&m.type==='ADJUSTMENT'&&!isTransaction(m)&&m.createdAt>first&&m.previousStock!==m.newStock);
      if(laterCounts.length)warnings.push({productId:p.id,reason:'A later manual stock adjustment exists; inspect before restoring all transaction deductions.',count:laterCounts.length});
      if(p.restore<0||p.after<0)warnings.push({productId:p.id,reason:'Negative transaction reversal requires review.'});
      if(data.products.find(r=>r.id===p.id).skuInventoryEnabled){
        const sizeTotal=data.skus.filter(s=>s.productId===p.id&&s.isActive).reduce((sum,s)=>sum+s.stock+(skuDeltas.get(s.id)??0),0);
        if(sizeTotal!==p.after)warnings.push({productId:p.id,reason:'Proposed active size totals do not equal product total.',product:p.after,sizes:sizeTotal});
      }
    }
    for(const b of batchChanges)if(b.after>b.received)warnings.push({batchId:b.id,reason:'Restored batch would exceed quantity received.'});
    const plan={mode:'READ_ONLY_DRY_RUN',projectRef:expected,generatedAt:new Date().toISOString(),backupRunId:process.env.GITHUB_RUN_ID,sourceCommit:process.env.GITHUB_SHA,snapshotHash:createHash('sha256').update(JSON.stringify(data)).digest('hex'),counts:data.counts,reservationsByStatus:Object.fromEntries([...new Set(data.reservations.map(r=>r.status))].map(status=>[status,data.reservations.filter(r=>r.status===status).length])),onlinePaymentStatuses:data.onlinePayments,stockRestoration:{products:productChanges,skus:skuChanges,variants:variantChanges,batches:batchChanges},transactionIds:{sales:data.sales.map(s=>s.id),receipts:data.sales.map(s=>s.receiptId),reservations:data.reservations.map(r=>r.id),movements:transactionMovements.map(m=>m.id)},transactionMovementCount:transactionMovements.length,warnings,preserved:['profiles and authentication','product catalog and selling prices','existing acquisition costs and batches','departments/categories/settings','audit history and non-transaction inventory history']};
    return plan;
}
async function main() {
  const expected = process.env.EXPECTED_SUPABASE_PROJECT_REF;
  assert.equal(expected, 'pffbftlyrovuprrebdsy', 'Unexpected production project');
  const connection = new URL(process.env.DATABASE_URL);
  const actual = connection.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]
    ?? decodeURIComponent(connection.username).match(/\.([a-z0-9]+)$/)?.[1];
  assert.equal(actual, expected, 'Database does not match the production project');
  assert.equal(connection.port || '5432', '5432', 'Use the direct/session backup endpoint');
  assert.ok(['require', 'verify-ca', 'verify-full'].includes(connection.searchParams.get('sslmode')), 'TLS required');
  const db = new PrismaClient({ log: [] });
  try {
    const data = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '25s'");
      return readSnapshot(tx);
    }, { timeout: 90000, maxWait: 10000, isolationLevel: 'RepeatableRead' });
    const plan=buildPlan(data,expected);
    fs.mkdirSync('reset-preview',{recursive:true});fs.writeFileSync('reset-preview/production-transaction-reset-plan.json',JSON.stringify(plan,null,2));
    console.log(JSON.stringify({mode:plan.mode,projectRef:expected,counts:plan.counts,productsToRestore:plan.stockRestoration.products.length,productUnitsToRestore:plan.stockRestoration.products.reduce((sum,p)=>sum+p.restore,0),warnings:plan.warnings.length,snapshotHash:plan.snapshotHash}));
  } finally { await db.$disconnect(); }
}
module.exports={readSnapshot,buildPlan};
if(require.main===module)main().catch(()=>{console.error('Read-only production preview failed; inspect the target configuration and database schema. No writes were permitted.');process.exitCode=1;});
