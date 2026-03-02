import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { Play, TrendingUp, Users } from 'lucide-react';

const Home = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState({ participants: 0, avg_score: 0 });
    const [canPlay, setCanPlay] = useState(true);
    const [message, setMessage] = useState("");

    useEffect(() => {
        // Mock fetch stats or implement API
        setStats({ participants: 1234, avg_score: 95 });

        // Check repeat
        const anonCode = localStorage.getItem('quiz_anon_code');
        if (anonCode) {
            client.post('/quiz/check_repeat', { anon_code: anonCode })
                .then(res => {
                    if (!res.data.can_play) {
                        setCanPlay(false);
                        setMessage(res.data.message);
                    }
                })
                .catch(err => console.error(err));
        }
    }, []);

    const startQuiz = () => {
        if (!canPlay) {
            alert(message || "您無法進行測驗");
            return;
        }
        navigate('/quiz');
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-br from-indigo-50 to-pink-50">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden p-8 text-center space-y-8 animate-fade-in relative border border-white/20">
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-primary to-secondary"></div>

                <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary mb-2">
                    功能性文盲大測驗
                </h1>
                <p className="text-gray-500 mb-6">
                    測驗你在語文、數理、生活與邏輯上的真實能力。
                    <br />
                    你的理解力，真的過關了嗎？
                </p>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-indigo-50 p-4 rounded-xl flex flex-col items-center">
                        <Users className="w-6 h-6 text-primary mb-2" />
                        <span className="text-sm text-gray-400">總參與人數</span>
                        <span className="text-2xl font-bold text-gray-700">{stats.participants}</span>
                    </div>
                    <div className="bg-pink-50 p-4 rounded-xl flex flex-col items-center">
                        <TrendingUp className="w-6 h-6 text-secondary mb-2" />
                        <span className="text-sm text-gray-400">平均分數</span>
                        <span className="text-2xl font-bold text-gray-700">{stats.avg_score}</span>
                    </div>
                </div>

                <div className="pt-4">
                    <button
                        onClick={startQuiz}
                        disabled={!canPlay}
                        className={`w-full py-4 text-xl font-bold text-white rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 group
                            ${canPlay ? 'bg-gradient-to-r from-primary to-secondary hover:shadow-2xl transform hover:-translate-y-1' : 'bg-gray-400 cursor-not-allowed opacity-75'}`}
                    >
                        <Play className="w-6 h-6 fill-current group-hover:scale-110 transition-transform" />
                        {canPlay ? "開始測驗" : "已完成測驗"}
                    </button>
                    {message && (
                        <p className="mt-2 text-center text-red-500 font-bold bg-red-50 p-2 rounded">{message}</p>
                    )}
                    <p className="mt-4 text-xs text-gray-300">
                        * 作答過程將採取匿名記錄，且有防作弊機制
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Home;
