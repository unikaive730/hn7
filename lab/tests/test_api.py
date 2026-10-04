"""Regression checks for discovery accounting and the demo HTTP boundary.

Run: python -m unittest discover -s lab/tests
"""
import unittest

from fastapi.testclient import TestClient

from lab.beeguard.api import app
from lab.beeguard.engine import get_lab


class DiscoveryAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.lab = get_lab()
        cls.pool_size = len(cls.lab.pool)

    def test_every_strategy_can_spend_the_whole_pool(self):
        for strategy in ('model', 'diversity', 'insecticide_only'):
            with self.subTest(strategy=strategy):
                response = self.client.post('/api/run', json={
                    'strategy': strategy, 'budget': self.pool_size,
                })
                self.assertEqual(response.status_code, 200)
                run = response.json()
                self.assertEqual(len(run['assays']), self.pool_size)
                self.assertEqual(run['budget'], self.pool_size)
                self.assertEqual(len({row['cid'] for row in run['assays']}), self.pool_size)
                self.assertEqual(run['found'], int(self.lab.is_target.sum()))
                curve = self.client.get('/api/curve', params={
                    'strategy': strategy, 'budget': self.pool_size,
                })
                self.assertEqual(curve.status_code, 200)
                points = curve.json()['points']
                self.assertEqual(len(points), self.pool_size)
                self.assertEqual(points[-1]['agent'], run['found'])
                self.assertTrue(all(a['agent'] <= b['agent'] for a, b in zip(points, points[1:])))

    def test_default_measured_headline_is_preserved(self):
        response = self.client.post('/api/run', json={'strategy': 'model', 'budget': 30})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['found'], 13)
        self.assertEqual(response.json()['speedup'], 6.37)

    def test_invalid_inputs_return_client_errors(self):
        for payload in (
            {'strategy': 'unknown', 'budget': 30},
            {'budget': 0},
            {'budget': self.pool_size + 1},
            {'cutoff_year': 9999},
            {'diversity_weight': -1},
        ):
            with self.subTest(payload=payload):
                self.assertIn(self.client.post('/api/run', json=payload).status_code, (400, 422))
        self.assertEqual(self.client.get('/api/curve?strategy=unknown').status_code, 422)
        for route in ('facts', 'curve', 'compare', 'headline', 'molecule/1'):
            self.assertEqual(self.client.get(f'/api/{route}?cutoff_year=9999').status_code, 422)

    def test_era_budget_reports_only_available_assays(self):
        year = 2010
        pool = len(get_lab(year).pool)
        run = get_lab(year).run(budget=1035)
        self.assertEqual(run['budget'], pool)
        self.assertEqual(run['requested_budget'], 1035)
        response = self.client.get('/api/curve', params={'cutoff_year': year, 'budget': 1035})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['budget'], pool)
        self.assertEqual(len(response.json()['points']), pool)
        self.assertEqual(self.client.post('/api/run', json={'cutoff_year': year, 'budget': pool + 1}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
