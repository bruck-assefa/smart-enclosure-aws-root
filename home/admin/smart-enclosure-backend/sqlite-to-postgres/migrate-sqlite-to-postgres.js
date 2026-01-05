const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

const BATCH_SIZE = 5000;   // Number of rows per insert
const BATCH_DELAY = 200;   // Delay in ms between batches (adjust as needed)

const sqliteDB = new sqlite3.Database('./sensorData.db');

// PostgreSQL connection
const pgClient = new Client({
  user: 'smart_user',
  host: 'localhost',
  database: 'smart_enclosure',
  password: 'sh9mKM&$Nk68',
  port: 5432
});

pgClient.connect();

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrateSensorData() {
  console.log('🔄 Starting sensor_data migration (batched)...');

  let batch = [];
  let insertedCount = 0;
  let batchNumber = 1;

  return new Promise((resolve, reject) => {
    sqliteDB.each(
      "SELECT * FROM sensor_data",
      async (err, row) => {
        if (err) return reject(err);

        batch.push([
          row.timestamp / 1000, // Convert ms to seconds
          row.sensor_id,
          row.temperature,
          row.humidity,
          row.pressure
        ]);

        if (batch.length >= BATCH_SIZE) {
          sqliteDB.pause(); // Pause reading while we insert

          const currentBatch = [...batch];
          batch = [];

          const query = `
            INSERT INTO sensor_data (timestamp, sensor_id, temperature, humidity, pressure)
            VALUES ${currentBatch.map((_, i) => `(
              to_timestamp($${i * 5 + 1}),
              $${i * 5 + 2},
              $${i * 5 + 3},
              $${i * 5 + 4},
              $${i * 5 + 5}
            )`).join(',')}
            ON CONFLICT DO NOTHING;
          `;

          const values = currentBatch.flat();

          try {
            await pgClient.query(query, values);
            insertedCount += currentBatch.length;
            console.log(`✅ Batch ${batchNumber++}: Inserted ${currentBatch.length} rows (Total: ${insertedCount})`);
          } catch (e) {
            console.error('❌ Error inserting batch:', e.message);
          }

          await delay(BATCH_DELAY);
          sqliteDB.resume();
        }
      },
      async (err, count) => {
        if (err) return reject(err);

        // Insert any remaining rows in final batch
        if (batch.length > 0) {
          const finalBatch = [...batch];
          const query = `
            INSERT INTO sensor_data (timestamp, sensor_id, temperature, humidity, pressure)
            VALUES ${finalBatch.map((_, i) => `(
              to_timestamp($${i * 5 + 1}),
              $${i * 5 + 2},
              $${i * 5 + 3},
              $${i * 5 + 4},
              $${i * 5 + 5}
            )`).join(',')}
            ON CONFLICT DO NOTHING;
          `;

          const values = finalBatch.flat();

          try {
            await pgClient.query(query, values);
            insertedCount += finalBatch.length;
            console.log(`✅ Final batch: Inserted ${finalBatch.length} rows (Total: ${insertedCount})`);
          } catch (e) {
            console.error('❌ Error inserting final batch:', e.message);
          }
        }

        console.log(`🎉 sensor_data migration complete. Total rows inserted: ${insertedCount}`);
        resolve();
      }
    );
  });
}

// Other smaller tables use the same functions from your original script (no batching needed)

async function migrateSensorAttributes() { /* same as before */ }
async function migrateFeedingSchedule() { /* same as before */ }
async function migrateRelaySchedule() { /* same as before */ }
async function migrateRelayScheduleHistory() { /* same as before */ }

// Run all migrations
(async () => {
  try {
    await migrateSensorData(); // batched version
    await migrateSensorAttributes();
    await migrateFeedingSchedule();
    await migrateRelaySchedule();
    await migrateRelayScheduleHistory();
    console.log('🎉 All migrations completed');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    pgClient.end();
    sqliteDB.close();
  }
})();


