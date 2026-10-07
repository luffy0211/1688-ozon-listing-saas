const contentTopic = "(?:内容|文案|标题|描述|简介|关键词|草案|草稿)";
const negative = "(?:不要|不用|无需|不需要|不做|先别|别)";

export function contentWorkExcluded(prompt: string) {
  return new RegExp(`${negative}[^，,。；;\\n]{0,12}${contentTopic}`, "i").test(prompt);
}

export function competitorWorkExcluded(prompt: string) {
  return new RegExp(`${negative}[^，,。；;\\n]{0,12}(?:竞品|竞争对手|同款)`, "i").test(prompt);
}

export function contentOptimizationRequested(prompt: string) {
  if (contentWorkExcluded(prompt)) return false;
  return /(内容优化|优化(?:店铺)?内容|优化商品|优化标题|标题优化|优化描述|描述优化|优化关键词|关键词优化|(?:修改|改|重写|完善)(?:店铺)?(?:商品)?(?:标题|描述|简介|关键词|文案)|生成草案|生成草稿|修改草案|修改草稿|内容草案|内容草稿|content|listing|draft)/i.test(prompt);
}

export function operationalTaskOnly(prompt: string) {
  if (contentOptimizationRequested(prompt)) return false;
  if (!competitorWorkExcluded(prompt) && /竞品|竞争对手|同款/.test(prompt)) return false;
  const operation = /库存|仓库|补货|可见性|订单|物流|发货|活动|促销|售价|价格|下架|归档/;
  if (!operation.test(prompt)) return false;
  return !/(?:完整|全面|深度|全部|所有).{0,8}(?:诊断|体检)|(?:诊断|体检).{0,8}(?:完整|全面|深度|全部|所有)/.test(prompt)
    || /(?:只|仅|单独).{0,12}(?:库存|仓库|补货|可见性|订单|物流|发货|活动|售价|价格)/.test(prompt);
}
