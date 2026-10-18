using System;
using AgentStudioLauncher;
class QuoteTests {
 static void Main() {
  string[] input={"", "simple", "C:\\Program Files\\nodejs\\node.exe", "tail\\", "a\"b", "C:\\folder\\\"quoted"};
  string[] expected={"\"\"", "\"simple\"", "\"C:\\Program Files\\nodejs\\node.exe\"", "\"tail\\\\\"", "\"a\\\"b\"", "\"C:\\folder\\\\\\\"quoted\""};
  for(int i=0;i<input.Length;i++)if(NativeJob.Quote(input[i])!=expected[i])throw new Exception("quote "+i);
  Console.WriteLine("Windows argument quoting: 6/6 (pure logic on Mono)");
 }
}
