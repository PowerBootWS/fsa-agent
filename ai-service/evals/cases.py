"""The tutor numeric-reasoning eval set.

Every expected value here was computed and checked before the case was written;
none is a remembered figure. The set exists because backlog #97's calculator
made the tutor's *arithmetic* sound but left its *reasoning* model-dependent —
which expression to use, which unit to answer in, and whether to pass a verdict
at all. Those are what these cases measure.

Categories:
  confirm-right     student gave the right answer; the tutor must say so
  reject-wrong      student gave a wrong answer; the tutor must reject it AND
                    state the right number, not just ask for her working
  no-answer         student asked a question and gave no answer of her own, so
                    any verdict at all is a hallucination
  expression-choice the naive formula yields a plausible wrong number
  unit-conversion   the answer must arrive in the unit that was asked for
  rounding          the student's sensibly-rounded answer must be accepted
  repeat-answer     the original #97 shape: she has already said it twice
"""
from evals.scoring import Case


HEAT = ('For 5 kg of water raised 60 °C with specific heat 4.187 kJ/kg·°C, ')
MIX = ('600 kg of brass at 200 °C is mixed with 400 kg of aluminium at 20 °C. '
       'Brass c = 0.39 kJ/kg·°C, aluminium c = 0.90 kJ/kg·°C. ')
THREE_PH = ('A three-phase motor runs at 600 V line voltage, 40 A line current, '
            'power factor 0.9. ')
BOILER = ('A boiler makes 5000 kg/h of steam at 2750 kJ/kg from feedwater at '
          '420 kJ/kg, burning 500 kg/h of fuel with a calorific value of '
          '30 000 kJ/kg. ')

CASES = [
    # ---------------------------------------------------------------- confirm
    Case('heat-confirm', 'confirm-right',
         HEAT + 'I get 1256.1 kJ. Is that right?',
         expect_value=1256.1, expect_verdict='confirm'),
    Case('power-1ph-confirm', 'confirm-right',
         'A single-phase load draws 25 A at 460 V with a power factor of 0.85. '
         'I make the real power 9.775 kW. Correct?',
         expect_value=9.775, expect_verdict='confirm'),
    Case('abs-pressure-confirm', 'confirm-right',
         'Gauge pressure is 850 kPa and atmospheric is 101.3 kPa. '
         'I make the absolute pressure 951.3 kPa. Right?',
         expect_value=951.3, expect_verdict='confirm'),
    Case('ohms-confirm', 'confirm-right',
         'A heater draws 12 A at 240 V. I work the resistance out as 20 ohms. Is that right?',
         expect_value=20, expect_verdict='confirm'),

    # ----------------------------------------------------------------- reject
    Case('heat-reject', 'reject-wrong',
         HEAT + 'I get 1500 kJ. Is that right?',
         expect_value=1256.1, expect_verdict='reject', student_value=1500),
    Case('power-3ph-reject', 'reject-wrong',
         THREE_PH + 'I make the power 21.6 kW. Is that right?',
         expect_value=37.41, expect_verdict='reject', tolerance=0.02,
         note='the wrong answer is what you get omitting root 3', student_value=21.6),
    Case('mixture-reject', 'reject-wrong',
         MIX + 'I make the final temperature 110 °C. Is that right?',
         expect_value=90.909, expect_verdict='reject', tolerance=0.02, student_value=110),
    Case('latent-reject', 'reject-wrong',
         'How much heat to evaporate 50 kg of water already at 100 °C, latent heat '
         '2257 kJ/kg? I make it 45 140 kJ. Is that right?',
         expect_value=112850, expect_verdict='reject', student_value=45140),

    # -------------------------------------------------------------- no answer
    Case('mixture-noanswer', 'no-answer',
         MIX + 'What is the final temperature?',
         expect_value=90.909, expect_verdict=None, tolerance=0.02),
    Case('efficiency-noanswer', 'no-answer',
         BOILER + 'What is the boiler efficiency?',
         expect_value=77.67, expect_verdict=None, tolerance=0.02, unit='%'),
    Case('parallel-noanswer', 'no-answer',
         'Two resistors, 6 ohms and 12 ohms, are connected in parallel. '
         'What is the combined resistance?',
         expect_value=4, expect_verdict=None),
    Case('deltat-noanswer', 'no-answer',
         'If I put 3000 kJ into 12 kg of water with specific heat 4.187 kJ/kg·°C, '
         'how much does the temperature rise?',
         expect_value=59.71, expect_verdict=None, tolerance=0.02),

    # ------------------------------------------------------- expression choice
    Case('piston-force', 'expression-choice',
         'Steam at 1200 kPa acts on a piston 0.25 m in diameter. What is the force on it?',
         expect_value=58.9, expect_verdict=None, tolerance=0.02, unit='kN',
         note='naive answer uses d squared instead of r squared, giving 4x'),
    Case('power-3ph-expression', 'expression-choice',
         THREE_PH + 'What is the real power drawn?',
         expect_value=37.41, expect_verdict=None, tolerance=0.02, unit='kW',
         note='naive answer omits root 3 and gives 21.6 kW'),
    Case('combined-heat', 'expression-choice',
         'How much heat is needed to take 10 kg of water at 20 °C and turn it all to '
         'steam at 100 °C? Specific heat 4.187 kJ/kg·°C, latent heat 2257 kJ/kg.',
         expect_value=25919.6, expect_verdict=None, tolerance=0.01,
         note='needs sensible AND latent; naive answer gives one term only'),
    Case('mixture-expression', 'expression-choice',
         MIX + 'Walk me through how to find the final temperature.',
         expect_value=90.909, expect_verdict=None, tolerance=0.02,
         note='needs m1c1(T1-Tf) = m2c2(Tf-T2), not a plain average'),

    # ------------------------------------------------------- unit conversion
    Case('heat-in-MJ', 'unit-conversion',
         'How much heat is needed to raise 2000 kg of water from 25 °C to 75 °C? '
         'Specific heat 4.183 kJ/kg·°C. Give me the answer in MJ.',
         expect_value=418.3, expect_verdict=None, unit='MJ'),
    Case('flow-in-kg-s', 'unit-conversion',
         'A pump delivers 300 litres per minute of water at 1000 kg/m³. '
         'What is the mass flow rate in kg/s?',
         expect_value=5, expect_verdict=None, unit='kg/s'),
    Case('steam-in-kg-s', 'unit-conversion',
         'A boiler produces 8000 kg/h of steam. What is that in kg/s?',
         expect_value=2.222, expect_verdict=None, tolerance=0.02, unit='kg/s'),

    # ------------------------------------------------------------- rounding
    Case('mixture-rounded', 'rounding',
         MIX + 'I get 90.9 °C. Is that right?',
         expect_value=90.9, expect_verdict='confirm', tolerance=0.02),
    Case('power-3ph-rounded', 'rounding',
         THREE_PH + 'I make it 37.4 kW. Is that right?',
         expect_value=37.4, expect_verdict='confirm', tolerance=0.02),
    Case('efficiency-rounded', 'rounding',
         BOILER + 'I make the efficiency 77.7%. Is that right?',
         expect_value=77.7, expect_verdict='confirm', tolerance=0.02),

    # --------------------------------------------------------- repeat answer
    Case('heat-repeat', 'repeat-answer',
         HEAT + "I have told you twice now that I get 1256.1 kJ and you keep saying "
         "I have a small decimal error. Am I wrong or not?",
         expect_value=1256.1, expect_verdict='confirm',
         note='the exact 2026-08-18 exchange that opened #97'),
    Case('mixture-repeat', 'repeat-answer',
         MIX + 'I keep getting 90.9 °C and you keep telling me to check my working. '
         'Please just tell me the number you get.',
         expect_value=90.909, expect_verdict='confirm', tolerance=0.02),
]
