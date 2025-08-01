#!/usr/bin/env node

import { getDbPath, createDb, createVectorIndex } from './utils.js';

// Main indexing function
async function runIndexing() {
  console.log('Starting to create vector index for Bear Notes...');
  
  // Connect to the database
  const dbPath = getDbPath();
  const db = createDb(dbPath);
  
  try {
    const result = await createVectorIndex(db);
    console.log(`Indexing complete. Indexed ${result.notesIndexed} notes.`);
  } catch (error) {
    console.error('Error creating vector index:', error);
    process.exit(1);
  } finally {
    // Close the database connection
    db.close();
  }
}

// Run the indexing
runIndexing().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Indexing failed:', error);
  process.exit(1);
});