-- Medium-level starter question bank. Run after schema.sql.
-- All questions start unpublished. Review and publish from Admin > Questions.
insert into public.questions(round_no,sequence_no,prompt,options,answer_key,points,checkpoint_label,is_published) values
(1,1,'Which data structure is most suitable for checking whether a value has appeared before, on average in constant time?','["A) Stack","B) Hash set","C) Queue","D) Linked list"]','B) Hash set',10,'Round 1 · Data Structures',false),
(1,2,'What is the time complexity of binary search on a sorted array?','["A) O(n)","B) O(n log n)","C) O(log n)","D) O(1)"]','C) O(log n)',10,'Round 1 · Algorithms',false),
(1,3,'Which HTTP status code usually indicates that a requested resource was not found?','["A) 200","B) 301","C) 403","D) 404"]','D) 404',10,'Round 1 · Web',false),
(2,1,'Decode the binary byte 01000011 as an ASCII character.','["A) A","B) B","C) C","D) D"]','C) C',10,'Round 2 · Binary Decode',false),
(2,2,'A sequence is 3, 6, 12, 24, __. What comes next?','["A) 36","B) 42","C) 48","D) 54"]','C) 48',10,'Round 2 · Logic',false),
(2,3,'In a Caesar cipher shifting each letter forward by 2, what does “EJ” decode to when shifted back by 2?','["A) CH","B) GL","C) DG","D) FI"]','A) CH',10,'Round 2 · Cipher',false),
(3,1,'A program visits every node in a connected graph without repeating a node, using a queue to explore neighbors level by level. Which traversal is it?','["A) DFS","B) BFS","C) In-order","D) Quick sort"]','B) BFS',10,'Round 3 · Graph Checkpoint',false),
(3,2,'Which logic gate outputs 1 only when its two inputs are different?','["A) AND","B) OR","C) XOR","D) NOR"]','C) XOR',10,'Round 3 · Logic Gate',false),
(3,3,'You find a QR clue containing the text “01001000 01001001”. Interpreted as ASCII binary, what does it spell?','["A) HI","B) OK","C) GO","D) IT"]','A) HI',10,'Round 3 · QR Challenge',false),
(4,1,'A system uses a 4-bit unsigned integer. What is the largest decimal value it can represent?','["A) 8","B) 15","C) 16","D) 31"]','B) 15',20,'Round 4 · Final Code',false),
(4,2,'Which SQL clause filters grouped results after GROUP BY has been applied?','["A) WHERE","B) ORDER BY","C) HAVING","D) DISTINCT"]','C) HAVING',20,'Round 4 · Final Code',false),
(4,3,'A hash function maps two different inputs to the same hash value. What is this called?','["A) Collision","B) Encryption","C) Recursion","D) Normalization"]','A) Collision',20,'Round 4 · Final Code',false)
on conflict(round_no,sequence_no) do nothing;
