const API_BASE = 'http://localhost:3000/api/documents';

interface DeleteResponse {
  success: boolean;
  deletedCount: number;
}

async function cleanAllData(): Promise<void> {
  console.log('🗑️  Deleting all vectors from database...\n');

  try {
    const response = await fetch(API_BASE, {
      method: 'DELETE',
    });

    const result: DeleteResponse = await response.json();

    if (result.success) {
      console.log(`✅ Successfully deleted ${result.deletedCount} documents`);
    } else {
      console.log('❌ Failed to delete documents');
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    console.log('\nMake sure the dev server is running: npm run dev');
  }
}

cleanAllData();
