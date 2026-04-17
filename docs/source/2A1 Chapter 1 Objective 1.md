Section Heading:  
Thickness and Pressure Limits

Content:  
In boiler and pressure piping work, two closely linked questions come up over and over: (1) how thick does a cylindrical component have to be to safely contain the pressure, and (2) for a given wall thickness, what is the highest pressure you are allowed to operate at. These calculations apply to common cylindrical parts in a plant—piping, tubes, drums, and headers—because internal pressure tries to “burst” the cylinder by creating hoop stress in the metal wall.

The objective here is to relate design pressure to required minimum wall thickness, or to relate a known thickness back to the maximum allowable working pressure. In practice, this is how an engineer or inspector confirms that a selected pipe or tube schedule is adequate, or how a plant determines the pressure limit for an older component after thickness loss from corrosion or erosion.

The scope is specifically ferrous (steel) tubing and similar cylindrical components up to and including 127 mm outside diameter. That size limit matters because codes sometimes use different relationships or assumptions for different geometries and sizes; staying within the stated range keeps you using the formulae as intended.

In a real plant context, these calculations support decisions such as:  
\- Selecting appropriate wall thickness when specifying new tubes, headers, or small drums.  
\- Verifying that a replacement spool or tube meets the required minimum thickness for the intended service pressure.  
\- Assessing whether remaining wall thickness (from inspection data) still supports the current operating pressure, or whether pressure must be reduced.

The referenced formulae come from ASME Section I (power boilers). That means they are part of the design and construction basis used to establish allowable limits, not just a “rule of thumb.” Operators should recognize that “maximum allowable working pressure” is a code-based limit tied to material strength, dimensions, and other code factors, and it becomes a key number for safe operation and for setting protective devices and operating procedures.

Section Heading:  
Shell Thickness Pressure Limits

Content:  
These two equations link three key design checks for a cylindrical pressure part (such as a boiler drum, header, or pressure vessel shell): allowable internal pressure, the diameter of the part, and the wall thickness available.

$$  
t \= \\frac{PD}{2S \+ P} \+ 0.005D \+ e \\tag{1.1}  
$$

Equation (1.1) is used when you know the intended working pressure (P), the size (D), and the allowable material strength term (S), and you need the minimum required wall thickness (t). The main fraction represents the pressure “loading” that must be resisted by the metal. If pressure (P) increases or diameter (D) increases, the required thickness (t) increases. If the allowable stress term (S) is higher, the required thickness decreases because the material can safely carry more stress.

The added terms “0.005D” and “e” act as additional thickness/allowance terms built into the requirement. Operationally, you can think of them as margins that must be added on top of the basic pressure-resisting thickness, so the final required t is more than just the fraction alone.

$$  
P \= S \\left\[ \\frac{2t \- 0.01D \- 2e}{D \- (t \- 0.005D \- e)} \\right\] \\tag{1.2}  
$$

Equation (1.2) rearranges the same relationship to solve for maximum allowable working pressure (P) when the available thickness (t) is known. This is the form typically used during fitness-for-service style checks in a plant setting: if inspections find wall thinning, you can use the remaining thickness to determine what pressure can still be safely carried.

As thickness (t) decreases (from corrosion/erosion), the calculated MAWP drops. For a given thickness, larger diameters (D) reduce MAWP, and a higher allowable stress term (S) increases MAWP.

In practice, these equations are only as good as the consistency of the inputs: use the same definitions and units for P, D, S, t, and e across both equations, and ensure the thickness used matches the measurement basis (where and how the wall was measured) for the component being evaluated.

Section Heading:  
Boiler Tube Wall Thickness

Content:  
Step 1 — Problem statement  
Calculate the minimum required wall thickness of a watertube boiler tube 70 mm O.D. that is strength welded into place in a boiler. The tube is located in the furnace area of the boiler and has an average wall temperature of 350°C. The maximum allowable working pressure is 4000 kPa gauge. The tube material is carbon steel SA-192.

\*\*Note:\*\* Check PG-6 for plate materials and PG-9 for boiler tube materials before starting calculations; the information will direct you to the correct stress table in ASME Section II, Part D by indicating if the metal is carbon steel or an alloy steel.

Step 2 — Choose the correct code equation  
\- Since the tube outside diameter is within the “up to and including 127 mm O.D.” range, equation 1.1 is the applicable minimum-thickness formula for this tubing case.  
\- The paragraph reference ties the calculation to the correct ASME rule set for tubes.

$$  
t \= \\frac{PD}{2S \+ P} \+ 0.005D \+ e  
$$

Step 3 — Insert code allowable stress and given values  
\- Identify the design pressure (P), tube outside diameter (D), weld/joint allowance (e), and allowable stress (S) at the stated metal temperature.  
\- Using the correct S value for SA-192 at 350°C is critical because tube metal temperature directly affects allowable stress and therefore the required thickness.

$$  
\\begin{array}{l}  
P \= 4000 \\mathrm{kPa} \= 4.0 \\mathrm{MPa} \\\\  
D \= 70 \\mathrm{mm} \\\\  
e \= 0 \\text{ (see PG-27.4, note 4, strength welded)} \\\\  
S \= 88.3 \\mathrm{MPa} \\text{ (see Table 1 or Section II, Part D, Table A1, SA-192 at } 350^{\\circ} \\mathrm{C}) \\\\  
t \= \\frac{4 \\times 70}{2(88.3) \+ 4} \+ 0.005(70) \+ 0 \\\\  
\= \\frac{280}{180.6} \+ 0.35 \\\\  
\= 1.55 \+ 0.35 \\\\  
\= 1.9 \\mathrm{mm} \\text{ (Ans.)} \\\\  
\\end{array}  
$$

Step 4 — State the minimum required thickness  
\- From the completed substitution and arithmetic, the calculated minimum required tube wall thickness is 1.9 mm.  
\- This is the code-calculated minimum before considering manufacturing tolerance.

Step 5 — Apply the post-calculation notes  
\- The calculated thickness excludes the manufacturer’s tolerance allowance (PG-16.5). In practice, a further allowance (about $12.5\\%$) is added so the delivered tube consistently meets or exceeds the minimum.  
\- The same thickness formula can be rearranged to find the maximum allowable working pressure when D and t are known, which is useful for assessing existing tubing.

Section Heading:  
Superheater Tube MAWP

Content:  
Step 1 Problem statement  
Calculate the maximum allowable working pressure, in kPa, for a 75 mm O.D. and 4.75 mm minimum thickness superheater tube connected to a header by strength welding. The average tube temperature is $400^{\\circ}\\mathrm{C}$. The tube material is SA-213-T11.

Note: Check PG-9 for boiler tube materials before starting calculations; the information will direct you to the correct stress table in ASME Section II, Part D. SA-213-T11 is alloy steel.

Step 2 Code case and equation choice  
For tubing up to and including $127\\mathrm{mm}$ O.D. Use equation 1.2.

(See paragraph PG-27.2.1.)

• This step confirms the correct ASME pressure formula based on tube outside diameter.

Step 3 Governing equation  
$$  
P \= S \\left\[ \\frac{2t \- 0.01D \- 2e}{D \- (t \- 0.005D \- e)} \\right\]  
$$  
• This provides the relationship to solve for allowable pressure using stress (S), geometry (D, t), and joint factor term (e).

Step 4 Known values from tube data and Code tables  
Where

$$  
\\begin{array}{l}  
t \= 4.75 \\mathrm{mm} \\\\  
D \= 75 \\mathrm{mm} \\\\  
e \= 0 \\text{ (see PG-27.4, note 4, strength welded.)} \\\\  
S \= 102 \\mathrm{MPa} \\text{ (Table 1 or Section II, Part D, Table A1, SA-213-T11 at } 400^{\\circ} \\mathrm{C}) \\\\  
\\end{array}  
$$  
• Thickness and OD come from the tube; (e) is set by the connection method.  
• (S) is selected at the stated metal temperature for the specified material.

Step 5 Substitute values into the equation  
$$  
\\begin{array}{l}  
P \= 102 \\times \\left\[ \\frac{(2 \\times 4.75) \- (0.01 \\times 75\) \- (2 \\times 0)}{75 \- (4.75 \- (0.005 \\times 75\) \- 0)} \\right\] \\\\  
\= 102 \\times \\left\[ \\frac{9.5 \- 0.75}{75 \- (4.75 \- 0.375)} \\right\] \\\\  
\= 102 \\times \\frac{8.75}{70.625} \\\\  
\= 12.64 \\mathrm{MPa} \= \\mathbf{12640 \\ kPa} \\ (\\mathrm{Ans.})  
\\end{array}  
$$  
• Substitution ties the specific tube dimensions and allowable stress directly to the Code equation.

Step 6 Result note on joint term  
The tubes were strength welded in Example 1 and Example 2\. For calculations involving tubes expanded into place, the appropriate value of $ e $ is found in paragraph PG-27.4, note 4\.  
• This clarifies that the selected (e) value depends on how the tube is attached, which can change the allowable pressure.

Section Heading:  
Thin Cylinder Pressure Formulas

Content:  
These ASME Section VIII relationships are used to connect internal design pressure and required wall thickness for tubes, pipes, and cylindrical vessel shells that are behaving as “thin” cylinders under internal pressure. In day to day plant terms, this is the sizing check behind items like air receivers, separators, small drums, and piping spools that see internal pressure.

Two different stress directions have to be considered because a pressurized cylinder is pulled apart in two ways:

1\) Circumferential (hoop) stress, which tends to split the shell lengthwise. This is most critical when the weld seam runs along the length of the cylinder (a longitudinal joint).

$$  
t \= \\frac{PR}{(SE \- 0.6P)} \\tag{1.3}  
$$

Or

$$  
P \= \\frac{SEt}{(R \+ 0.6t)} \\tag{1.4}  
$$

These “thin shell” equations are applied when $ t \&lt; 0.5R $ or $ P \&lt; 0.385SE $.

2\) Longitudinal (axial) stress, which tends to pull the end caps away from the shell, putting axial tension into the cylinder wall. This becomes important for circumferential welds (girth joints) that wrap around the shell.

$$  
t \= \\frac{PR}{(2SE \- 0.4P)} \\tag{1.5}  
$$

Or

$$  
P \= \\frac{2SEt}{(R \+ 0.4t)} \\tag{1.6}  
$$

These apply under the “thin shell” limits $ t \&lt; 0.5R $ or $ P \&lt; 1.25SE $.

How to interpret the variables in practice: (P) is the internal design pressure you are checking, (t) is the required wall thickness (before any allowances not shown here), and (R) is the cylinder radius used in the calculation. The terms (S) and (E) represent the code basis for material strength and joint quality in the welded construction, which is why the stress case is tied to whether the joint is longitudinal or circumferential.

In design or troubleshooting, you use these equations either way: pick a pressure and find the minimum thickness, or pick a known thickness and determine the maximum allowable pressure. Both stress directions are checked, and the governing result is the one that sets the required thickness or limiting pressure.

Section Heading:  
Thick Wall Pressure Design

Content:  
When a pressure vessel cylinder becomes “thick walled,” the usual thin shell assumptions no longer give accurate stresses. Two common flags in this extract are high pressure (above $20.6\\,\\mathrm{MPa}$) and a wall that is not small compared with the radius, especially when the thickness-to-radius ratio increases and the condition $t \> 0.5\\,\\mathrm{R}$ applies. In that range, the stress is not uniform through the wall; it varies from the inside surface to the outside surface, so a thick-wall relationship is used.

The starting thick-cylinder stress relationship shown is:

$$  
SE \= \\frac{P(R\_0^2 \+ R^2)}{(R\_0^2 \- R^2)}  
$$

Here $R\_0$ is the outside radius and $R$ is the inside radius. (P) is the internal pressure. (SE) is the code stress term used in these relationships. This equation links the geometry (inside vs outside radius) to the pressure level that produces the governing stress condition.

Because designers and inspectors often work with thickness rather than outside radius, the text substitutes $R\_0 \= R \+ t$ to solve directly for the required wall thickness (t). An intermediate factor (Z) is defined to simplify the algebra and keep the final thickness expression compact:

$$  
t \= R \\left(Z^{\\frac{1}{2}} \- 1\\right) \\quad \\text{Where} \\quad Z \= \\frac{(SE \+ P)}{(SE \- P)} \\tag{1.7}  
$$

The stated applicability limits remind you when the thick-wall form must be used instead of thin-wall: $t \> 0.5\\,\\mathrm{R}$ or $P \> 0.385\\,\\mathrm{SE}$. The accompanying rearranged form gives pressure (P) when geometry and (SE) are known:

$$  
P \= SE \\left\[ \\frac{(Z \- 1)}{(Z \+ 1)} \\right\] \\quad \\text{Where} \\quad Z \= \\left\[ \\frac{(R \+ t)}{R} \\right\]^2 \\tag{1.8}  
$$

A separate set is provided for longitudinal stress (axial stress along the vessel). The trigger conditions are more restrictive because the stress relationship differs: $t \> 0.5\\,\\mathrm{R}$ or $P \> 1.25\\,\\mathrm{SE}$.

$$  
t \= R \\left(Z^{\\frac{1}{2}} \- 1\\right) \\quad \\text{Where} \\quad Z \= \\left(\\frac{P}{SE}\\right) \+ 1 \\tag{1.9}  
$$

and the rearrangement for pressure:

$$  
P \= SE (Z \- 1\) \\quad \\text{Where} \\quad Z \= \\left\[ \\frac{(R \+ t)}{R} \\right\]^2 \\tag{1.10}  
$$

In plant terms, these thick-wall equations show up in the design and rerate checks for high-pressure cylinders (for example, heavy-wall drums, reactors, or other pressure-containing shells) where thickness is a large fraction of radius. The note limits these formulae to internal pressure only, so they should not be used to represent external pressure or combined loading cases.

Section Heading:  
Boiler Shell Thickness

Content:  
Step 1 — Problem statement (given)  
A vertical boiler is constructed of SA-515-60 material in accordance with the requirements of Section VIII-1. It has an inside diameter of $2440\\,\\mathrm{mm}$ and an internal design pressure of $690\\,\\mathrm{kPa}$ at $230^{\\circ}\\mathrm{C}$. The corrosion allowance is $3\\,\\mathrm{mm}$, and joint efficiency is 0.85. Calculate the required thickness of the shell if the allowable stress is $138\\,\\mathrm{MPa}$.

Step 2 — Choose the correct code equation  
Use the code validity check by comparing 0.385SE \= 45.16\\ \\mathrm{MPa} to the design pressure P \= 690\\ \\mathrm{kPa}.  
\- Since 45.16 MPa is greater than P, equation 1.3 (UG-27) is the appropriate thin-shell pressure formula to apply.

Step 3 — Set the corroded inside radius  
The inside radius in a corroded condition is $1220 \+ 3\\ \\mathrm{mm} \= 1223\\ \\mathrm{mm}$  
\- The pressure term uses the radius at the corroded (minimum remaining metal) condition, so the corrosion allowance is added before calculating thickness.

Step 4 — Apply the thickness calculation (equation, substitution, and arithmetic)  
$$  
\\begin{array}{l}  
t \= \\frac{PR}{(SE \- 0.6P)} \+ \\text{corrosion allowance} \\\\  
\= \\frac{0.69 \\times 1223}{(138 \\times 0.85) \- 0.6(0.69)} \+ 3 \\\\  
\= \\frac{843.87}{116.886} \+ 3 \\\\  
\= 7.22 \+ 3 \\\\  
\= 10.22\\ \\mathrm{mm} \\text{ (Ans.)}  
\\end{array}  
$$  
\- Start with equation 1.3 for a cylindrical shell and include corrosion allowance as an added thickness.  
\- Substitute the design pressure, corroded radius, allowable stress, and joint efficiency to account for weld strength.  
\- Work through the line-by-line simplification to reach the required minimum shell thickness.

Step 5 — Confirm the thin-shell assumption  
The calculated thickness is less than $0.5R$; therefore, equation 1.3 is acceptable.  
\- This check confirms the geometry is within the intended range for using the thin-cylinder code equation.

Section Heading:  
Accumulator Shell Thickness

Content:  
Step 1: Problem statement (given data)  
Calculate the required shell thickness of an accumulator with $P \= 69\\ \\mathrm{MPa}$, $R \= 45.7\\ \\mathrm{cm}$, $S \= 138\\ \\mathrm{MPa}$, and $E \= 1.0$. Assume a corrosion allowance of 6 mm.  
\- Establishes the design pressure, vessel size (radius), allowable stress, weld/joint efficiency, and extra metal needed for corrosion.

Step 2: Decide which thickness equation applies  
The quantity $0.385SE \= 53.13\\ \\mathrm{MPa}$; since this is less than the design pressure $P \= 69\\ \\mathrm{MPa}$, use equation 1.7.  
\- This check compares a stress-based threshold to the design pressure to confirm the correct “thick shell” form of the equation.

Step 3: Use the thick-shell formula and calculate Z  
$$  
\\begin{array}{l}  
t \= R \\left(Z^{\\frac{1}{2}} \- 1\\right) \\quad \\text{Where} \\quad Z \= \\frac{SE \+ P}{SE \- P} \\\\  
Z \= \\frac{(138 \\times 1\) \+ 69}{(138 \\times 1\) \- 69} \\\\  
\= \\frac{207}{69} \\\\  
\= 3 \\\\  
\\end{array}  
$$  
\- Identifies the governing relationship for required thickness (t) and computes the intermediate pressure-stress ratio (Z) needed to proceed.

Step 4: Substitute radius (with allowance shown) into the equation  
$$  
\\begin{array}{l}  
t \= (457 \+ 6\) \\left(3^{\\frac{1}{2}} \- 1\\right) \\\\  
\= 463 \\times 0.732 \\\\  
\= 338.92\\ \\mathrm{mm}  
\\end{array}  
$$  
\- Converts the given radius to millimetres (45.7 cm → 457 mm) and applies the stated 6 mm allowance as used in the substitution.  
\- Produces the calculated shell thickness from the thick-shell relationship before the final stated total is reported.

Step 5: Source/footer line from the original text  
Revised Second Class Course • Section A1 • SI Units  
\- This is a course reference note and does not change the calculation.

Step 6: Add corrosion allowance to report total required thickness  
Total including corrosion allowance  
$$  
\\begin{array}{l}  
t \= 338.92 \+ 6 \\\\  
\= 344.92 \\text{ mm (Ans.)}  
\\end{array}  
$$  
\- Finalizes the specified required thickness by including the corrosion allowance as stated, giving the thickness to be provided/ordered.

Section Heading:  
Accumulator shell thickness

Content:  
Step 1 — Problem statement (verbatim)  
Calculate the required shell thickness of an accumulator with $P \= 52.75$ MPa, $R \= 45.7$ cm, $S \= 138$ MPa, and $E \= 1.0$. Assume corrosion allowance \= 0\.

Step 2 — Check which equation applies  
The quantity $0.385\\mathrm{SE} \= 53.13\\mathrm{MPa}$; since this is greater than the design pressure $P \= 52.75\\mathrm{MPa}$, use equation 1.3.  
\- This comparison confirms the pressure level is within the range where equation 1.3 is permitted, so you don’t apply the wrong thickness rule.

Step 3 — Apply equation 1.3 and include corrosion allowance  
$$  
\\begin{array}{l}  
t \= \\frac{PR}{SE \- 0.6P} \+ \\text{corrosion allowance} \\\\  
\= \\frac{52.75 \\times 457}{(138 \\times 1\) \- 0.6(52.75)} \+ 0 \\\\  
\= \\frac{24106.75}{106.35} \\\\  
\= 226.67 \\text{ mm (Ans.)}  
\\end{array}  
$$  
\- This step substitutes the given pressure, radius, allowable stress, and joint efficiency into the selected design equation.  
\- The corrosion allowance term is shown explicitly so it’s clear that it contributes zero in this case.

Step 4 — Set up the alternate equation for comparison  
This example used equation 1.3; compare the answer using equation 1.7  
$$  
t \= R \\left(Z^{\\frac{1}{2}} \- 1\\right) \\quad \\text{Where} \\quad Z \= \\frac{SE \+ P}{SE \- P}  
$$  
\- Using a second approved equation provides a quick cross-check on the thickness result.

Step 5 — Calculate the intermediate term Z  
$$  
\\begin{array}{l}  
Z \= \\frac{(138 \\times 1\) \+ 52.75}{(138 \\times 1\) \- 52.75} \\\\  
\= \\frac{190.75}{85.25} \\\\  
\= 2.2375  
\\end{array}  
$$  
\- Z gathers the stress and pressure terms into one value needed before solving for (t).

Step 6 — Calculate thickness using equation 1.7  
$$  
\\begin{array}{l}  
t \= 457 \\left(2.2375^{\\frac{1}{2}} \- 1\\right) \\\\  
\= 457 \\times 0.4958 \\\\  
\= 226.59 \\text{ mm (Ans.)}  
\\end{array}  
$$  
\- This produces a second thickness value using the same input data, letting you check consistency.

Step 7 — Interpret the comparison  
\- The two answers (226.67 mm vs 226.59 mm) are essentially the same, indicating equation 1.3 gives a very close estimate for these conditions and is suitable across a broad range of R/t ratios.

