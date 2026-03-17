import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Label
} from 'recharts';
import { 
  Settings, 
  Info, 
  Calculator, 
  Target, 
  Code, 
  FunctionSquare, 
  Table, 
  Cpu,
  Layers,
  Activity,
  Thermometer,
  Database
} from 'lucide-react';

const App = () => {
  // Estados para configuração
  const [method, setMethod] = useState('secant');
  const [region, setRegion] = useState('full');
  const [lutSize, setLutSize] = useState(16);
  const [temperature, setTemperature] = useState(25); // Novo estado: Compensação Térmica

  // Constantes do Datasheet SHT1x (12-bit)
  const C1 = -2.0468;
  const C2 = 0.0367;
  const C3 = -0.0000015955;
  const T1 = 0.01;
  const T2 = 0.00008;

  // Função auxiliar: Conversão Quadrática com Compensação Térmica (Datasheet completo)
  const getTrueRH = (so, t = 25) => {
    const rh_lin = C1 + (C2 * so) + (C3 * so * so);
    return (t - 25) * (T1 + T2 * so) + rh_lin;
  };
  
  // Função auxiliar: Derivada (para método da tangente) - Aproximada para T=25 para simplificar
  const getDerivative = (so) => C2 + (2 * C3 * so);

  // Mapeamento de Regiões
  const regionsMap = {
    full: { min: 100, max: 3100, label: "Escala Completa (0-100% RH)" },
    low: { min: 100, max: 1200, label: "Baixa Humidade (0-35% RH)" },
    mid: { min: 1000, max: 2200, label: "Gama Média (30-70% RH)" },
    high: { min: 2000, max: 3100, label: "Alta Humidade (65-100% RH)" }
  };

  // Cálculo Dinâmico dos Coeficientes Lineares (Para comparação visual)
  const coefs = useMemo(() => {
    const { min, max } = regionsMap[region];
    let m = 0;
    let b = 0;

    if (method === 'trunc') {
      m = C2;
      b = C1;
    } else if (method === 'secant') {
      const y1 = getTrueRH(min, temperature);
      const y2 = getTrueRH(max, temperature);
      m = (y2 - y1) / (max - min);
      b = y1 - m * min;
    } else if (method === 'tangent') {
      const midPoint = (min + max) / 2;
      m = getDerivative(midPoint);
      b = getTrueRH(midPoint, temperature) - m * midPoint;
    }

    return { m, b };
  }, [method, region, temperature]);

  // Geração da Lookup Table (LUT) - Usando a curva não linear à temperatura atual
  const lutData = useMemo(() => {
    const { min, max } = regionsMap[region];
    const n = Math.max(2, lutSize);
    const step = (max - min) / (n - 1);
    const table = [];
    
    for (let i = 0; i < n; i++) {
      const so = Math.round(min + i * step);
      const val = getTrueRH(so, temperature);
      table.push({ so, val: Math.min(100, Math.max(0, val)) });
    }

    const arrayString = table.map((row, idx) => {
      const valScaled = Math.round(row.val * 10);
      const comma = (idx === table.length - 1) ? "" : ", ";
      const newLine = ((idx + 1) % 8 === 0) ? "\n  " : "";
      return valScaled.toString().padStart(4, ' ') + comma + newLine;
    }).join('');

    return { table, step, min, max, arrayString };
  }, [lutSize, region, temperature]);

  // Geração de dados unificada para o gráfico
  const chartData = useMemo(() => {
    const points = [];
    const soValues = new Set();
    
    for (let so = 0; so <= 3300; so += 25) soValues.add(so);
    lutData.table.forEach(p => soValues.add(p.so));
    
    Array.from(soValues).sort((a, b) => a - b).forEach(so => {
      // Valor Real (Curva Azul)
      const rh_quad = Math.min(100, Math.max(0, getTrueRH(so, temperature)));
      // Valor Linear (Curva Laranja)
      const rh_linear = coefs.m * so + coefs.b;
      const error_linear = rh_linear - rh_quad;
      
      // Valor da LUT em "Degrau" (Acesso direto em C sem interpolação) e Interpolação Linear (Opc. 1.B)
      let stepped_val = 0;
      let interp_val = 0;
      if (so <= lutData.min) {
        stepped_val = lutData.table[0].val;
        interp_val = lutData.table[0].val;
      }
      else if (so >= lutData.max) {
        stepped_val = lutData.table[lutSize - 1].val;
        interp_val = lutData.table[lutSize - 1].val;
      }
      else {
        const range = lutData.max - lutData.min;
        const scaled_so = (so - lutData.min) * (lutSize - 1);
        const idx = Math.floor(scaled_so / range);
        const rem = scaled_so % range;
        
        stepped_val = lutData.table[idx].val;
        
        // Cálculo do valor com interpolação (simulando C)
        const v0 = lutData.table[idx].val;
        const v1 = lutData.table[idx + 1].val;
        interp_val = v0 + ((v1 - v0) * rem) / range;
      }
      const error_lut = stepped_val - rh_quad;
      const error_interp = interp_val - rh_quad;

      const isLutPoint = lutData.table.some(p => p.so === so);

      points.push({
        so: so,
        quad: parseFloat(rh_quad.toFixed(2)),
        linear: parseFloat(rh_linear.toFixed(2)),
        stepped: parseFloat(stepped_val.toFixed(2)),
        error: parseFloat(error_linear.toFixed(2)),
        errorLut: parseFloat(error_lut.toFixed(2)),
        errorInterp: parseFloat(error_interp.toFixed(3)),
        lutPoint: isLutPoint ? parseFloat(rh_quad.toFixed(2)) : null
      });
    });

    return points;
  }, [coefs, lutData, lutSize, temperature]);

  const getMethodName = () => {
    if (method === 'trunc') return "Truncagem Simples";
    if (method === 'secant') return "Secante Otimizada";
    return "Tangente Local";
  };

  // Lógica iterativa para a recomendação técnica
  const techAnalysis = useMemo(() => {
    let maxErrorLinear = 0;
    let maxErrorLut = 0;
    let maxErrorInterp = 0;
    chartData.forEach(p => {
        if (p.so >= regionsMap[region].min && p.so <= regionsMap[region].max) {
            maxErrorLinear = Math.max(maxErrorLinear, Math.abs(p.error));
            maxErrorLut = Math.max(maxErrorLut, Math.abs(p.errorLut));
            maxErrorInterp = Math.max(maxErrorInterp, Math.abs(p.errorInterp));
        }
    });

    const isHighError = maxErrorLinear > 2.0;

    return {
        error: maxErrorLinear.toFixed(1),
        errorLut: maxErrorLut.toFixed(1),
        errorInterp: maxErrorInterp.toFixed(3),
        perf: method === 'trunc' ? "Muito Alta" : "Média-Alta",
        advice: isHighError 
            ? `O método ${getMethodName()} apresenta um erro de até ${maxErrorLinear.toFixed(1)}% nesta gama. Recomenda-se vivamente o uso da LUT para manter a precisão do datasheet.`
            : `Boa precisão! Na gama ${region}, a linearização está próxima da curva real. No entanto, observe o erro de quantização (dente de serra) ao aceder à tabela sem interpolação.`,
        comparison: `A LUT de ${lutSize} pontos introduz um erro de quantização de ${maxErrorLut.toFixed(1)}%. Para anular este erro, use a função com interpolação linear (Opção 1.B).`
    };
  }, [method, region, chartData, lutSize]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 font-sans text-slate-800 pb-12">
      <header className="bg-white border-b border-slate-200 px-6 py-6 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Layers className="text-blue-600" />
              SHT1x
            </h1>
            <p className="text-slate-500 text-sm">Carlos Abreu (ESTG-IPVC)</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex items-center gap-3">
            <div className="p-2 bg-blue-500 rounded text-white"><Calculator size={18}/></div>
            <div>
              <div className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Simulador</div>
              <div className="text-sm font-mono font-bold text-blue-900">
                Resposta Não Linear | Linearização
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        <div className="lg:col-span-1 space-y-6">
          <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
              <Settings size={14} /> Cenário de Aplicação
            </h3>
            <div className="space-y-5">
              
              {/* Novo Slider de Temperatura */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-700 text-xs font-bold uppercase flex items-center gap-1">
                    <Thermometer size={14} className="text-blue-500"/> Temperatura
                  </label>
                  <span className="text-xs font-bold text-blue-600">{temperature}ºC</span>
                </div>
                <input type="range" min="-10" max="80" step="5" className="w-full accent-blue-500" value={temperature} onChange={e => setTemperature(parseInt(e.target.value))} />
                <div className="text-[10px] text-slate-500 mt-1 leading-tight italic">Demonstra a compensação térmica (t1, t2) na curva real.</div>
              </div>

              <div>
                <label className="text-slate-700 text-xs font-bold block mb-1 uppercase">Gama da %RH</label>
                <select className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-sm outline-none focus:border-blue-500" value={region} onChange={e => setRegion(e.target.value)}>
                  <option value="full">Total (0-100%)</option>
                  <option value="low">Baixa (0-35%)</option>
                  <option value="mid">Média (30-70%)</option>
                  <option value="high">Alta (65-100%)</option>
                </select>
              </div>
              
              <div>
                <label className="text-slate-700 text-xs font-bold block mb-1 uppercase">Pontos da Lookup Table (LUT)</label>
                <input type="number" min="4" max="128" className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-sm" value={lutSize} onChange={e => setLutSize(parseInt(e.target.value) || 4)} />
                {/* Indicador Pedagógico de Memória */}
                <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-2 font-mono bg-slate-100 p-1.5 rounded">
                  <Database size={12} className="text-slate-400"/> 
                  <span>Consumo Flash: <strong className="text-slate-700">{lutSize * 2} Bytes</strong></span>
                </div>
              </div>

              <hr className="border-slate-100"/>

              <div>
                <label className="text-slate-700 text-xs font-bold block mb-1 uppercase">Método de Linearização</label>
                <select className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-sm outline-none" value={method} onChange={e => setMethod(e.target.value)}>
                  <option value="trunc">Truncagem</option>
                  <option value="secant">Secante</option>
                  <option value="tangent">Tangente</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
              <FunctionSquare size={14} /> Fórmulas
            </h3>
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 rounded border border-blue-100 text-[11px] font-mono leading-relaxed">
                <div className="text-blue-600 font-bold underline mb-1">Fórmula Não Linear (Compensada):</div>
                RHlin = C1 + C2·SO + (C3)·SO²<br/>
                RH = ({temperature}-25)·(T1+T2·SO) + RHlin
              </div>
              <div className="p-3 bg-orange-50 rounded border border-orange-100 text-[11px] font-mono leading-relaxed">
                <div className="text-orange-600 font-bold underline mb-1">Fórmula Linear ({getMethodName()}):</div>
                RH = {coefs.m.toFixed(6)}·SO {coefs.b >= 0 ? '+' : '-'} {Math.abs(coefs.b).toFixed(4)}
              </div>
            </div>
          </section>
        </div>

        <div className="lg:col-span-3 space-y-6">
          
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
             <h2 className="font-bold text-lg mb-6 flex items-center gap-2">
                <Target className="text-blue-500" size={20}/>
                Comparação: Efeito da Quantização e Linearização
             </h2>
             <div className="h-[380px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="so" stroke="#94a3b8" tick={{ fontSize: 11 }}>
                        <Label value="SOrh (Leitura Bruta)" offset={-10} position="insideBottom" style={{ fontSize: '11px', fill: '#64748b' }} />
                    </XAxis>
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} domain={[0, 110]}>
                        <Label value="% RH" angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fontSize: '11px', fill: '#64748b' }} />
                    </YAxis>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                    <Legend verticalAlign="top" height={36} iconType="circle" />
                    
                    <Line name="Não Linear (Datasheet)" type="monotone" dataKey="quad" stroke="#2563eb" strokeWidth={3} dot={false} connectNulls={true} />
                    <Line name={`Reta Linear (${getMethodName()})`} type="monotone" dataKey="linear" stroke="#fb923c" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={true} />
                    
                    {/* Linha em Degrau: Demonstra a leitura da matriz C sem interpolação */}
                    <Line name="LUT em Degrau (Leitura C direta)" type="stepBefore" dataKey="stepped" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls={true} />
                    
                    <Line name="Pontos na LUT (Memória)" type="monotone" dataKey="lutPoint" stroke="none" dot={{ r: 4, fill: '#10b981', strokeWidth: 1, stroke: '#fff' }} />
                    
                    <ReferenceLine x={regionsMap[region].min} stroke="#f43f5e" strokeDasharray="3 3" />
                    <ReferenceLine x={regionsMap[region].max} stroke="#f43f5e" strokeDasharray="3 3" />
                  </LineChart>
                </ResponsiveContainer>
             </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-xs font-bold uppercase text-slate-400 mb-4 flex items-center gap-2">
               <Activity size={14} className="text-slate-400" />
               Análise de Erro (Quantização vs Linearização)
            </h3>
            <div className="h-[140px] w-full">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f8fafc" />
                    <XAxis dataKey="so" hide />
                    <YAxis tick={{ fontSize: 9 }} stroke="#cbd5e1" />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
                    
                    {/* Área de Erro da Reta Linear */}
                    <Area name="Erro da Reta Linear" type="monotone" dataKey="error" fill="#f1f5f9" stroke="#94a3b8" connectNulls={true} fillOpacity={0.6} />
                    {/* Área de Erro em Dente de Serra (Quantização da LUT) */}
                    <Area name="Erro de Quantização LUT" type="stepBefore" dataKey="errorLut" fill="#e9d5ff" stroke="#a855f7" connectNulls={true} fillOpacity={0.4} />

                    <ReferenceLine x={regionsMap[region].min} stroke="#f43f5e" strokeWidth={1} />
                    <ReferenceLine x={regionsMap[region].max} stroke="#f43f5e" strokeWidth={1} />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 flex flex-col overflow-hidden">
               <div className="p-4 bg-slate-800 flex items-center justify-between border-b border-slate-700">
                  <h3 className="text-white text-sm font-bold flex items-center gap-2"><Table size={16} className="text-emerald-400" /> C Lookup Table & Métodos</h3>
               </div>
               <div className="p-5 bg-slate-950 font-mono text-[10px] text-emerald-400 overflow-y-auto max-h-[500px]">
<pre>
{`// 1. DADOS DA TABELA (QUADRÁTICA REAL)
const uint16_t SHT1x_RH_LUT[] = {
  ${lutData.arrayString}
};

/**
 * @brief OPÇÃO 1.A: CÁLCULO VIA LUT (Acesso Direto / Degrau)
 * Performance extrema, mas gera o erro dente de serra.
 */
uint16_t sht1x_calc_rh_lut(uint16_t so_raw) {
    if (so_raw < ${Math.round(lutData.min)}) return SHT1x_RH_LUT[0];
    if (so_raw > ${Math.round(lutData.max)}) return SHT1x_RH_LUT[${lutSize - 1}];
    uint32_t range = ${Math.round(lutData.max - lutData.min)};
    uint16_t idx = ((uint32_t)(so_raw - ${Math.round(lutData.min)}) * ${lutSize - 1}) / range;
    return SHT1x_RH_LUT[idx];
}

/**
 * @brief OPÇÃO 1.B: LUT COM INTERPOLAÇÃO LINEAR (Recomendado)
 * Anula o erro de quantização (dente de serra) via software.
 */
uint16_t sht1x_calc_rh_lut_interp(uint16_t so_raw) {
    if (so_raw <= ${Math.round(lutData.min)}) return SHT1x_RH_LUT[0];
    if (so_raw >= ${Math.round(lutData.max)}) return SHT1x_RH_LUT[${lutSize - 1}];

    uint32_t range = ${Math.round(lutData.max - lutData.min)};
    uint32_t scaled_so = (so_raw - ${Math.round(lutData.min)}) * ${lutSize - 1};
    uint16_t idx = scaled_so / range;
    uint16_t rem = scaled_so % range;

    uint16_t v0 = SHT1x_RH_LUT[idx];
    uint16_t v1 = SHT1x_RH_LUT[idx + 1];

    return v0 + ((v1 - v0) * rem) / range;
}

/**
 * @brief OPÇÃO 2: MÉTODO LINEAR (Matemática simples)
 * Coeficientes para: ${getMethodName()} em ${region}
 */
uint16_t sht1x_calc_rh_linear(uint16_t so_raw) {
    float rh = (${coefs.m.toFixed(6)}f * so_raw) ${coefs.b >= 0 ? '+' : '-'} ${Math.abs(coefs.b).toFixed(4)}f;
    return (uint16_t)(rh * 10);
}

/**
 * @brief OPÇÃO 3: MÉTODO NÃO LINEAR (Custo CPU elevado)
 * Requer compensação de temperatura.
 */
uint16_t sht1x_calc_rh_quad(uint16_t so_raw, float temp) {
    float rh_lin = ${C1}f + (${C2}f * so_raw) + (${C3}f * so_raw * so_raw);
    float rh_true = (temp - 25.0f) * (${T1}f + ${T2}f * so_raw) + rh_lin;
    return (uint16_t)(rh_true * 10);
}`}
</pre>
               </div>
            </div>

            <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 flex flex-col overflow-hidden text-slate-300">
               <div className="p-4 bg-slate-800 flex items-center justify-between border-b border-slate-700">
                  <h3 className="text-white text-sm font-bold flex items-center gap-2"><Cpu size={16} className="text-blue-400" /> Vantagem Técnica e Recomendação</h3>
               </div>
               <div className="p-5 text-[11px] space-y-4">
                  <div>
                    <strong className="text-blue-400 uppercase block mb-1">Análise de Performance:</strong>
                    <ul className="list-disc pl-4 space-y-2">
                      <li><strong>Erro Linear:</strong> A linearização ({getMethodName()}) introduz um desvio de <strong>{techAnalysis.error}% RH</strong>.</li>
                      <li><strong>Quantização (Opc. 1.A):</strong> Ler a tabela diretamente cria "degraus" que originam o erro roxo (<strong>{techAnalysis.errorLut}%</strong> máximo).</li>
                      <li><strong>Interpolação (Opc. 1.B):</strong> <em>Esta é a melhor prática em Engenharia Mecatrónica.</em> Usa inteiros, é rápida, suaviza o dente de serra perfeitamente e reduz o erro máximo para apenas <strong>{techAnalysis.errorInterp}% RH</strong>.</li>
                    </ul>
                  </div>
                  <div className="pt-3 border-t border-slate-800">
                    <strong className="text-emerald-400 uppercase block mb-1">Recomendação Iterativa:</strong>
                    <p>{techAnalysis.advice} {techAnalysis.comparison}</p>
                  </div>
                  <div className="pt-3 border-t border-slate-800">
                    <strong className="text-white uppercase block mb-1 font-mono">Implementação Contiki OS:</strong>
                    <pre className="bg-black p-2 rounded text-emerald-400 text-[9px] mt-1">
{`/* Uso no laboratório do IPVC */
#include "dev/sht11/sht11.h"
uint16_t raw = sht11_humidity();

// Chama a Opção 1.B (Interpolação perfeita)
uint16_t rh = sht1x_calc_rh_lut_interp(raw);
printf("RH: %u.%u %%\\n", rh/10, rh%10);`}
                    </pre>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
