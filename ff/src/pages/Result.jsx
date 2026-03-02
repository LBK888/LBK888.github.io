import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { Share2, RefreshCw, Home as HomeIcon } from 'lucide-react';
import html2canvas from 'html2canvas';

const Result = () => {
    const { state } = useLocation();
    const navigate = useNavigate();
    const [isSharing, setIsSharing] = useState(false);

    // Fallback if no state (direct access)
    const result = state || {
        score: 0,
        rank_percent: 0,
        analysis: "無法取得數據，請重新測驗。",
        category_scores: { "語文": 0, "數理": 0, "生活": 0, "邏輯": 0 }
    };

    const data = Object.keys(result.category_scores).map(key => ({
        subject: key,
        A: result.category_scores[key] * 100, // Convert to 0-100 scale for chart
        fullMark: 100,
    }));

    const handleShare = async () => {
        const resultCard = document.getElementById('result-card');
        if (!resultCard) return;

        setIsSharing(true);

        try {
            const canvas = await html2canvas(resultCard, {
                backgroundColor: '#f8fafc',
                scale: 2,
                useCORS: true,
                logging: false
            });
            const link = document.createElement('a');
            link.download = `功能性文盲測驗結果_${Math.round(result.score)}分.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (error) {
            console.error('截圖失敗:', error);
            alert('截圖產生失敗，請稍後再試');
        } finally {
            setIsSharing(false);
        }
    };

    return (
        <div className="min-h-screen bg-light py-10 px-4 flex flex-col items-center">
            <div className="bg-white rounded-3xl shadow-2xl overflow-hidden max-w-4xl w-full" id="result-card">
                {/* Header */}
                <div className="bg-gradient-to-r from-primary to-accent p-8 text-center text-white">
                    <h2 className="text-3xl font-bold mb-2">測驗結果分析</h2>
                    <p className="opacity-90">Functional Illiteracy Quiz Report</p>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Score Section */}
                    <div className="flex flex-col items-center justify-center space-y-4">
                        <div className="relative w-48 h-48 flex items-center justify-center">
                            <div className="absolute inset-0 rounded-full border-8 border-indigo-50"></div>
                            <div className="absolute inset-0 rounded-full border-8 border-primary border-t-transparent animate-spin-slow" style={{ animationDuration: '3s' }}></div>
                            <div className="flex flex-col items-center">
                                <span className="text-6xl font-black text-dark">{Math.round(result.score)}</span>
                                <span className="text-sm text-gray-400">綜合能力指數</span>
                            </div>
                        </div>

                        <div className="text-center">
                            <p className="text-gray-600 mb-2">
                                你的表現超越了 <span className="text-secondary font-bold text-xl">{result.rank_percent}%</span> 的受測者
                            </p>
                            <span className="inline-block px-4 py-1 bg-indigo-100 text-primary rounded-full text-sm font-bold">
                                {result.score > 130 ? "全能天才" : result.score > 100 ? "邏輯大師" : "潛力無限"}
                            </span>
                        </div>
                    </div>

                    {/* Chart Section */}
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
                                <PolarGrid stroke="#e2e8f0" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 14 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                <Radar
                                    name="能力"
                                    dataKey="A"
                                    stroke="#8b5cf6"
                                    strokeWidth={3}
                                    fill="#8b5cf6"
                                    fillOpacity={0.4}
                                />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Category Bars */}
                <div className="px-8 pb-8">
                    <h3 className="text-lg font-bold text-dark mb-4 border-b pb-2">📊 各類別得分</h3>
                    <div className="flex flex-col gap-4">
                        {Object.entries(result.category_scores).map(([cat, score], idx) => {
                            const value = Math.round(score * 100);
                            const hue = (idx * 360 / Math.max(1, Object.keys(result.category_scores).length)) % 360;
                            const gradient = `linear-gradient(90deg, hsl(${hue}, 70%, 55%), hsl(${hue}, 60%, 65%))`;
                            return (
                                <div key={cat} className="flex items-center gap-4">
                                    <span className="w-16 text-sm font-bold text-gray-700">{cat}</span>
                                    <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-1000 ease-out"
                                            style={{ width: `${value}%`, background: gradient }}
                                        ></div>
                                    </div>
                                    <span className="w-12 text-right text-sm font-bold text-gray-500">{value}%</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Analysis Text */}
                <div className="bg-indigo-50 p-6 m-8 rounded-xl border border-indigo-100">
                    <h3 className="text-lg font-bold text-dark mb-2 flex items-center gap-2">
                        💡 詳細分析
                    </h3>
                    <p className="text-gray-700 leading-relaxed">
                        {result.analysis}
                        <br /><br />
                        根據你的作答情況，你在{Object.entries(result.category_scores).sort((a, b) => b[1] - a[1])[0]?.[0]}方面表現最為優異。
                    </p>
                </div>

                {/* Actions */}
                <div className="p-8 pt-0 flex flex-col md:flex-row gap-4 justify-center">
                    <button
                        onClick={() => navigate('/')}
                        className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors font-bold"
                    >
                        <HomeIcon size={20} />
                        回首頁
                    </button>
                    <button
                        onClick={handleShare}
                        disabled={isSharing}
                        className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-colors font-bold shadow-lg shadow-blue-200 disabled:bg-gray-400 disabled:shadow-none"
                    >
                        {isSharing ? (
                            <>
                                <RefreshCw className="animate-spin" size={20} />
                                產生中...
                            </>
                        ) : (
                            <>
                                <Share2 size={20} />
                                分享結果
                            </>
                        )}
                    </button>
                    <button
                        onClick={() => navigate('/quiz')}
                        className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all font-bold"
                    >
                        <RefreshCw size={20} />
                        再次挑戰
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Result;
