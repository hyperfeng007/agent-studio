// Build-time audit only. Uses Mono.Cecil, never shipped as a runtime dependency.
using System;
using System.IO;
using System.Collections.Generic;
using Mono.Cecil;
sealed class FrameworkResolver : IAssemblyResolver {
    readonly string directory;
    readonly Dictionary<string,AssemblyDefinition> loaded=new Dictionary<string,AssemblyDefinition>();
    public FrameworkResolver(string path) { directory=path; }
    public AssemblyDefinition Resolve(AssemblyNameReference name) { return Resolve(name,new ReaderParameters()); }
    public AssemblyDefinition Resolve(AssemblyNameReference name,ReaderParameters unused) {
        if(loaded.ContainsKey(name.Name))return loaded[name.Name];
        string file=Path.Combine(directory,name.Name+".dll");
        if(!File.Exists(file))throw new AssemblyResolutionException(name);
        var assembly=AssemblyDefinition.ReadAssembly(file,new ReaderParameters { AssemblyResolver=this });
        loaded.Add(name.Name,assembly); return assembly;
    }
    public void Dispose() { foreach(var value in loaded.Values)value.Dispose(); }
}
class VerifyFrameworkApi {
    static int Main(string[] args) {
        int total=0,errors=0;
        using(var resolver=new FrameworkResolver(args[1]))
        using(var module=ModuleDefinition.ReadModule(args[0],new ReaderParameters { AssemblyResolver=resolver })) {
            foreach(var member in module.GetMemberReferences()) {
                try {
                    bool found=true;
                    var method=member as MethodReference;var field=member as FieldReference;
                    if(method!=null)found=method.Resolve()!=null;
                    else if(field!=null)found=field.Resolve()!=null;
                    else continue;
                    total++;
                    if(!found) { errors++; Console.WriteLine("MISSING: "+member.FullName); }
                } catch(Exception e) { errors++;Console.WriteLine("UNRESOLVED: "+member.FullName+" / "+e.Message); }
            }
        }
        Console.WriteLine("Framework reference audit: "+total+" members, "+errors+" missing/unresolved");
        return errors==0?0:1;
    }
}
