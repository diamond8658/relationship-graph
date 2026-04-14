import sqlite3

conn = sqlite3.connect('relationship_graph.db')
cursor = conn.cursor()

# Check existing columns first
cursor.execute("PRAGMA table_info(people)")
cols = [row[1] for row in cursor.fetchall()]
print("Current columns:", cols)

if 'description' not in cols:
    cursor.execute('ALTER TABLE people ADD COLUMN description TEXT DEFAULT ""')
    print("Added description column")
else:
    print("description column already exists")

conn.commit()
conn.close()
print("Done")
