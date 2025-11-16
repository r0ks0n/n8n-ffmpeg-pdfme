// Quick script to check template structure
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function checkTemplate() {
  const { rows } = await pool.query(
    'SELECT id, name, template FROM templates WHERE id = $1',
    ['177137c7-cec4-4d95-93ee-516a5b185444']
  );

  if (!rows[0]) {
    console.log('Template not found');
    process.exit(1);
  }

  const template = rows[0].template;
  console.log('=== TEMPLATE STRUCTURE ===\n');
  console.log('Name:', rows[0].name);
  console.log('Multi-page enabled:', template._multiPageEnabled);
  console.log('Has second base PDF:', !!template._secondBasePdf);
  console.log('\n=== SCHEMAS ===\n');

  template.schemas.forEach((pageSchemas, pageIdx) => {
    console.log(`\nPage ${pageIdx + 1}:`);
    pageSchemas.forEach((field, fieldIdx) => {
      console.log(`  Field ${fieldIdx + 1}:`);
      console.log(`    name: "${field.name}"`);
      console.log(`    type: "${field.type}"`);
      console.log(`    content: "${field.content || '(none)'}"`);
      console.log(`    position: x=${field.position?.x}, y=${field.position?.y}`);
      console.log(`    width: ${field.width}, height: ${field.height}`);
    });
  });

  await pool.end();
}

checkTemplate().catch(console.error);
