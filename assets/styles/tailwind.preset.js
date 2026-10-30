// tailwind.config.js -> presets: [require("./logflow-assets/styles/tailwind.preset.js")]
module.exports={theme:{extend:{
  colors:{lf:{navy:"#0B1B33","navy-700":"#132A4D","navy-500":"#5B7099","navy-300":"#9FB4D9",teal:"#14B8A6","teal-600":"#0F9488",blue:"#3B6BFF","blue-600":"#2A52D6",bg:"#F6F8FB",surface:"#FFFFFF",border:"#DCE3EC"},
    level:{trace:"#64748B",debug:"#8B5CF6",info:"#2563EB",warn:"#D97706",error:"#DC2626",fatal:"#9D174D"}},
  fontFamily:{display:['"Space Grotesk"',"Inter","sans-serif"],sans:["Inter","system-ui","sans-serif"],mono:['"JetBrains Mono"',"ui-monospace","monospace"]},
  borderRadius:{lf:"8px","lf-lg":"14px"}}}};
