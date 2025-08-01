#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getDbPath,
  createDb,
  searchNotes,
  retrieveNote,
  getAllTags,
  loadVectorIndex,
  initEmbedder,
  retrieveForRAG,
  createVectorIndex
} from './utils.js';

// Initialize dependencies
async function initialize() {
  console.error('Initializing Bear Notes MCP server...');
  
  // Initialize database connection
  const dbPath = getDbPath();
  const db = createDb(dbPath);
  
  // Initialize embedding model
  const modelInitialized = await initEmbedder();
  if (!modelInitialized) {
    console.error('Warning: Embedding model initialization failed, semantic search will not be available');
  }
  
  // Load vector index
  const indexLoaded = await loadVectorIndex();
  if (!indexLoaded) {
    console.error('Warning: Vector index not found, semantic search will not be available');
    console.error('Run "npm run index" to create the vector index');
  }
  
  return { db, hasSemanticSearch: modelInitialized && indexLoaded };
}

// Main function
async function main() {
  // Initialize components
  const { db, hasSemanticSearch } = await initialize();
  
  // Create MCP server
  const server = new Server(
    {
      name: 'bear-notes',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      }
    }
  );

  // Register the list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      {
        name: 'search_notes',
        description: 'Search for notes in Bear that match a query',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to find matching notes',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
            },
            semantic: {
              type: 'boolean',
              description: 'Use semantic search instead of keyword search (default: true)',
            }
          },
          required: ['query'],
        },
      },
      {
        name: 'get_note',
        description: 'Retrieve a specific note by its ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier of the note to retrieve',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_tags',
        description: 'Get all tags used in Bear Notes',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'reindex_notes',
        description: 'Re-index all notes to update the vector search index',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'find_note_by_partial_id',
        description: 'Find a note by partial ID when you only have part of the UUID',
        inputSchema: {
          type: 'object',
          properties: {
            partial_id: {
              type: 'string',
              description: 'Partial ID or title fragment to search for',
            },
          },
          required: ['partial_id'],
        },
      }
    ];
    
    // Add RAG tool if semantic search is available
    if (hasSemanticSearch) {
      tools.push({
        name: 'retrieve_for_rag',
        description: 'Retrieve notes that are semantically similar to a query for RAG',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Query for which to find relevant notes',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of notes to retrieve (default: 5)',
            },
          },
          required: ['query'],
        },
      });
    }
    
    return { tools };
  });

  // Register the call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'search_notes') {
      const { query, limit = 10, semantic = true } = request.params.arguments;
      const useSemanticSearch = semantic && hasSemanticSearch;
      
      try {
        const notes = await searchNotes(db, query, limit, useSemanticSearch);
        return { 
          content: [
            {
              type: "text",
              text: `Found ${notes.length} notes using ${useSemanticSearch ? 'semantic' : 'keyword'} search:\n\n${notes.map(note => `**${note.title}**\nID: ${note.id}\n${note.content}\n`).join('\n')}`
            }
          ]
        };
      } catch (error) {
        return { 
          content: [
            {
              type: "text",
              text: `Search failed: ${error.message}`
            }
          ]
        };
      }
    }
    
    if (request.params.name === 'get_note') {
      const { id } = request.params.arguments;
      try {
        const note = await retrieveNote(db, id);
        return { 
          content: [
            {
              type: "text",
              text: `**${note.title}**\n\n${note.content}\n\n*Tags: ${note.tags.join(', ')}*\n*Created: ${note.creation_date}*`
            }
          ]
        };
      } catch (error) {
        return { 
          content: [
            {
              type: "text",
              text: `Error retrieving note: ${error.message}`
            }
          ]
        };
      }
    }
    
    if (request.params.name === 'get_tags') {
      try {
        const tags = await getAllTags(db);
        return { 
          content: [
            {
              type: "text",
              text: `Available tags (${tags.length}):\n\n${tags.map(tag => `• ${tag}`).join('\n')}`
            }
          ]
        };
      } catch (error) {
        return { 
          content: [
            {
              type: "text",
              text: `Error retrieving tags: ${error.message}`
            }
          ]
        };
      }
    }
    
    if (request.params.name === 'retrieve_for_rag' && hasSemanticSearch) {
      const { query, limit = 5 } = request.params.arguments;
      try {
        const context = await retrieveForRAG(db, query, limit);
        return { 
          content: [
            {
              type: "text",
              text: `Retrieved ${context.length} relevant notes for: "${query}"\n\n${context.map(note => `**${note.title}**\nID: ${note.id}\n${note.content}\n*Score: ${note.score?.toFixed(3) || 'N/A'}*\n`).join('\n')}`
            }
          ]
        };
      } catch (error) {
        return { 
          content: [
            {
              type: "text",
              text: `RAG retrieval failed: ${error.message}`
            }
          ]
        };
      }
    }
    
    if (request.params.name === 'reindex_notes') {
      try {
        const result = await createVectorIndex(db);
        return { 
          content: [
            {
              type: "text",
              text: `Successfully re-indexed ${result.notesIndexed} notes. Vector search index has been updated.`
            }
          ]
        };
      } catch (error) {
        return { 
          content: [
            {
              type: "text",
              text: `Re-indexing failed: ${error.message}`
            }
          ]
        };
      }
    }
    
    if (request.params.name === 'find_note_by_partial_id') {
      const { partial_id } = request.params.arguments;
      try {
        const notes = await db.allAsync(`
          SELECT 
            ZUNIQUEIDENTIFIER as id,
            ZTITLE as title,
            ZTEXT as content,
            ZSUBTITLE as subtitle,
            ZCREATIONDATE as creation_date
          FROM ZSFNOTE
          WHERE ZTRASHED = 0 AND (ZUNIQUEIDENTIFIER LIKE ? OR ZTITLE LIKE ?)
          ORDER BY ZMODIFICATIONDATE DESC
          LIMIT 10
        `, [`%${partial_id}%`, `%${partial_id}%`]);
        
        if (notes.length === 0) {
          return { 
            content: [
              {
                type: "text",
                text: `No notes found matching partial ID or title: "${partial_id}"`
              }
            ]
          };
        }
        
        // Get tags for each note
        for (const note of notes) {
          try {
            const tags = await db.allAsync(`
              SELECT ZT.ZTITLE as tag_name
              FROM Z_5TAGS J
              JOIN ZSFNOTETAG ZT ON ZT.Z_PK = J.Z_13TAGS
              JOIN ZSFNOTE ZN ON ZN.Z_PK = J.Z_5NOTES
              WHERE ZN.ZUNIQUEIDENTIFIER = ?
            `, [note.id]);
            note.tags = tags.map(t => t.tag_name);
          } catch (tagError) {
            note.tags = [];
          }
          
          // Convert Apple's timestamp
          if (note.creation_date) {
            note.creation_date = new Date((note.creation_date + 978307200) * 1000).toISOString();
          }
        }
        
        return { 
          content: [
            {
              type: "text",
              text: `Found ${notes.length} notes matching "${partial_id}":\n\n${notes.map(note => `**${note.title}**\nFull ID: ${note.id}\n${note.content.substring(0, 200)}...\n*Tags: ${note.tags.join(', ')}*\n`).join('\n')}`
            }
          ]
        };
      } catch (error) {
        return { 
          content: [
            {
              type: "text",
              text: `Search failed: ${error.message}`
            }
          ]
        };
      }
    }
    
    throw new McpError(ErrorCode.MethodNotFound, 'Tool not found');
  });

  // Use stdio transport instead of HTTP
  const transport = new StdioServerTransport();

  // Start the server with stdio transport
  await server.connect(transport);

  // Handle process termination
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
    process.on(signal, () => {
      console.error(`Received ${signal}, shutting down Bear Notes MCP server...`);
      db.close(() => {
        console.error('Database connection closed.');
        process.exit(0);
      });
    });
  });

  // Important: Log to stderr for debugging, not stdout
  console.error('Bear Notes MCP server ready');
}

// Run the main function
main().catch(error => {
  console.error('Server error:', error);
  process.exit(1);
});